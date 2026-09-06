import { loadConfig } from '../src/config.js';
import { LarkClient } from '../src/lark.js';
import { StudioAgent } from '../src/agent.js';
import { buildBatchId } from '../src/fact-id.js';

function argumentNumber(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  return Math.max(Number(value) || fallback, 1);
}

function matrixRecords(output) {
  const data = output?.data || {};
  const fields = data.fields || [];
  return (data.data || []).map((row, index) => ({
    recordId: data.record_id_list?.[index] || '',
    fields: Object.fromEntries(fields.map((field, column) => [field, row[column]])),
  }));
}

function messageTimestamp(value) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  return Date.parse(text.replace(' ', 'T')) || 0;
}

const days = argumentNumber('days', 30);
const config = loadConfig();
const lark = new LarkClient(config);
const agent = new StudioAgent(config, lark);
await agent.refreshRuntimeMappings();

const mapping = [...agent.chatMappings.values()].find((item) => item.chatName === '开发组');
if (!mapping) throw new Error('未找到已启用的“开发组”群聊配置');
if (mapping.routeMode !== '影子') throw new Error('开发组当前不是影子模式，拒绝执行影子历史回补');

const end = new Date().toISOString();
const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const history = lark.listChatMessages(mapping.chatId, {
  start,
  end,
  identity: config.history.identity || 'user',
  pageSize: config.history.pageSize || 100,
  maxPages: Math.max(Number(config.history.maxPages) || 20, 100),
});
const messages = history.messages
  .map((message) => agent.normalizeHistoryMessage(message, mapping.chatId))
  .filter((message) => message.message_id && !message.deleted)
  .sort((left, right) => messageTimestamp(left.create_time) - messageTimestamp(right.create_time));
const linkByMessageId = new Map(messages
  .filter((message) => message.message_app_link)
  .map((message) => [message.message_id, message.message_app_link]));

let deterministicRoutes = 0;
const chunkSize = 100;
for (let index = 0; index < messages.length; index += chunkSize) {
  const chunk = messages.slice(index, index + chunkSize);
  const batchId = buildBatchId({
    chatId: mapping.chatId,
    source: '影子历史路由',
    messageIds: chunk.map((message) => message.message_id),
  });
  const routes = await agent.routeBatch({
    mapping,
    messages: chunk,
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    redactionTypes: [],
  }, batchId, { deterministicOnly: true, semanticSuggestions: false });
  deterministicRoutes += routes.length;
}

const routeOutput = lark.listRecords(config.tables.messageRoutes, ['消息ID', '消息链接']);
const linkUpdates = {};
for (const record of matrixRecords(routeOutput)) {
  const messageId = String(record.fields['消息ID'] || '').trim();
  const link = linkByMessageId.get(messageId);
  if (!record.recordId || !link || record.fields['消息链接']) continue;
  linkUpdates[record.recordId] = { '消息链接': link };
}
lark.updateRecords(config.tables.messageRoutes, linkUpdates);

console.log(JSON.stringify({
  ok: true,
  mode: 'deterministic-route-only',
  modelCalls: 0,
  chatName: mapping.chatName,
  start,
  end,
  fetchedMessages: messages.length,
  deterministicRoutes,
  linksBackfilled: Object.keys(linkUpdates).length,
  pages: history.pages,
  truncated: history.truncated,
}, null, 2));
