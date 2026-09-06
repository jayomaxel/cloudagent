import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/config.js";
import { larkCliInvocation } from "../src/lark-cli-process.js";
import { buildMessageReviewFields } from "../src/message-review-display.js";

const config = loadConfig();
const apply = process.argv.includes("--apply");
const backfill = process.argv.includes("--backfill");
const cli = process.env.LARK_CLI_ENTRY || config.larkCliEntry;
const tableName = "Agent 消息项目归属";
const reviewViewName = "负责人审核视图";

const readableFields = [
  { name: "消息内容预览", type: "text", description: "脱敏后的消息短预览，最多 120 字，不保存完整聊天原文" },
  { name: "发送人姓名", type: "text", description: "供负责人识别消息发送者的显示姓名" },
  { name: "Agent建议归属", type: "text", description: "项目正式名称、组织管理或待确认" },
  { name: "判断说明", type: "text", description: "面向负责人的可读判断依据" },
  { name: "审核提示", type: "text", description: "负责人需要执行的下一步操作" },
];

const visibleFields = [
  "消息概览", "消息内容预览", "发送人姓名", "群聊名称", "消息时间", "Agent建议归属", "判断说明",
  "置信度", "审核状态", "审核提示", "关联项目", "消息链接",
];

function run(args, { safeRetry = true } = {}) {
  const attempts = safeRetry ? 4 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const invocation = larkCliInvocation(cli, [...args, "--format", "json"]);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: config.root,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
      },
    });
    try {
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || `lark-cli exited ${result.status}`);
      const start = result.stdout.indexOf("{");
      const payload = JSON.parse(result.stdout.slice(start));
      if (payload.ok === false) throw new Error(payload.error?.message || JSON.stringify(payload.error));
      return payload;
    } catch (error) {
      lastError = error;
      if (!/(EOF|ECONNRESET|ETIMEDOUT|network|socket|连接|网络)/i.test(String(error.message))) break;
    }
  }
  throw lastError;
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function getTableId() {
  const output = run(["base", "+table-list", "--base-token", config.baseToken, "--as", "user", "--limit", "100"]);
  const table = (output.data?.tables || []).find((item) => item.name === tableName);
  if (!table) throw new Error(`找不到数据表：${tableName}`);
  return table.id;
}

function ensureFields(targetTableId) {
  const output = run(["base", "+field-list", "--base-token", config.baseToken, "--table-id", targetTableId, "--as", "user", "--limit", "200"]);
  const existing = new Set((output.data?.fields || []).map((field) => field.name));
  const missing = readableFields.filter((field) => !existing.has(field.name));
  if (apply && missing.length) {
    run([
      "base", "+field-create", "--base-token", config.baseToken, "--table-id", targetTableId, "--as", "user",
      "--json", JSON.stringify(missing),
    ], { safeRetry: false });
  }
  return missing.map((field) => field.name);
}

function ensureReviewView(targetTableId) {
  const output = run(["base", "+view-list", "--base-token", config.baseToken, "--table-id", targetTableId, "--as", "user", "--limit", "100"]);
  let view = (output.data?.views || []).find((item) => item.name === reviewViewName);
  if (!apply) return { exists: Boolean(view), id: view?.id || null };
  if (!view) {
    const created = run([
      "base", "+view-create", "--base-token", config.baseToken, "--table-id", targetTableId, "--as", "user",
      "--json", JSON.stringify({ name: reviewViewName, type: "grid" }),
    ], { safeRetry: false });
    view = created.data?.views?.[0] || created.data?.view || created.data;
  }
  const viewId = view?.id || view?.view_id || reviewViewName;
  run([
    "base", "+view-set-visible-fields", "--base-token", config.baseToken, "--table-id", targetTableId,
    "--view-id", viewId, "--as", "user", "--json", JSON.stringify({ visible_fields: visibleFields }),
  ], { safeRetry: false });
  return { exists: true, id: viewId };
}

function readRows(targetTableId) {
  const requestedFields = [
    "消息ID", "群聊名称", "归属类型", "正式项目名称", "归属依据", "置信度", "审核状态",
    "消息内容预览", "发送人姓名", "Agent建议归属", "判断说明", "审核提示",
  ];
  const rows = [];
  let offset = 0;
  while (true) {
    const args = [
      "base", "+record-list", "--base-token", config.baseToken, "--table-id", targetTableId,
      "--as", "user", "--limit", "200", "--offset", String(offset),
    ];
    requestedFields.forEach((field) => args.push("--field-id", field));
    const output = run(args);
    const data = output.data || {};
    (data.data || []).forEach((values, index) => {
      rows.push({
        recordId: data.record_id_list[index],
        fields: Object.fromEntries(requestedFields.map((field, fieldIndex) => [field, values[fieldIndex]])),
      });
    });
    if (!data.has_more || !(data.data || []).length) break;
    offset += data.data.length;
  }
  return rows;
}

function fetchMessages(messageIds) {
  const messages = new Map();
  for (const batch of chunks(messageIds, 50)) {
    try {
      const output = run(["im", "+messages-mget", "--message-ids", batch.join(","), "--as", "user", "--no-reactions"]);
      for (const message of output.data?.messages || []) messages.set(message.message_id, message);
    } catch (error) {
      console.warn(`历史消息批次回读失败：${error.message}`);
    }
  }
  return messages;
}

function buildBackfillUpdates(rows, messages) {
  const updates = {};
  for (const row of rows) {
    const current = row.fields;
    const messageId = current["消息ID"];
    const message = messages.get(messageId) || {};
    const ownershipType = current["归属类型"];
    const route = {
      type: ownershipType === "项目" ? "project" : ownershipType === "组织管理" ? "organization" : "unknown",
      projectName: current["正式项目名称"] || "",
      reason: current["归属依据"] || "",
      confidence: current["置信度"],
      reviewStatus: current["审核状态"],
    };
    const review = buildMessageReviewFields({ message, route });
    const fields = {};
    if (!current["消息内容预览"]) fields["消息内容预览"] = messageId && !messages.has(messageId) ? "原消息不可回读" : review.messagePreview;
    if (!current["发送人姓名"]) fields["发送人姓名"] = messages.has(messageId) ? review.senderName : "未识别成员";
    if (!current["Agent建议归属"]) fields["Agent建议归属"] = review.suggestedOwnership;
    if (!current["判断说明"]) fields["判断说明"] = review.judgmentExplanation;
    if (!current["审核提示"]) fields["审核提示"] = review.reviewPrompt;
    if (Object.keys(fields).length) updates[row.recordId] = fields;
  }
  return updates;
}

function applyUpdates(targetTableId, updates) {
  const entries = Object.entries(updates);
  for (const batch of chunks(entries, 200)) {
    run([
      "base", "+record-batch-update", "--base-token", config.baseToken, "--table-id", targetTableId, "--as", "user",
      "--json", JSON.stringify({ update_records: Object.fromEntries(batch) }),
    ]);
  }
}

function main() {
  const targetTableId = getTableId();
  const missingFields = ensureFields(targetTableId);
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", tableName, missingFields, backfillRequested: backfill }, null, 2));
    return;
  }

  const view = ensureReviewView(targetTableId);
  let backfilledRows = 0;
  let readableMessages = 0;
  if (backfill) {
    const rows = readRows(targetTableId);
    const ids = [...new Set(rows.map((row) => row.fields["消息ID"]).filter((id) => /^om_/.test(String(id || ""))))];
    const messages = fetchMessages(ids);
    const updates = buildBackfillUpdates(rows, messages);
    applyUpdates(targetTableId, updates);
    backfilledRows = Object.keys(updates).length;
    readableMessages = messages.size;
  }

  console.log(JSON.stringify({
    ok: true,
    tableName,
    createdFields: missingFields,
    reviewView: view,
    backfilledRows,
    readableMessages,
  }, null, 2));
}

main();
