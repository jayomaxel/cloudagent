import { sanitizeMessages } from './security.js';

export function buildRoutingPrompt({ messages, projects }) {
  const { messages: safeMessages } = sanitizeMessages(messages || []);
  const catalog = (projects || []).map((project) => ({
    name: project.name,
    aliases: project.aliases || [],
  }));
  return JSON.stringify({
    instruction: '只从项目目录中选择项目。无法确定时 projectName 为空。模型结果只作为人工待确认建议。',
    projects: catalog,
    messages: safeMessages.map((message) => ({
      messageId: message.message_id || message.messageId,
      replyMessageId: message.replyMessageId || message.reply_to || message.parent_id || '',
      text: String(message.text || message.content || '').replace(/\btoken\s*[:=]\s*[^\s,;]+/gi, 'token=[REDACTED:TOKEN]'),
    })),
    output: [{ messageId: 'string', projectName: 'string|null', confidence: 0, reason: 'string' }],
  });
}

export function normalizeSemanticSuggestions(suggestions, formalProjectNames, allowedMessageIds = null) {
  const allowed = formalProjectNames instanceof Set
    ? formalProjectNames
    : new Set(formalProjectNames || []);
  return (Array.isArray(suggestions) ? suggestions : []).map((item) => {
    const projectName = allowed.has(item.projectName) ? item.projectName : '';
    return {
      messageId: String(item.messageId || ''),
      projectName,
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      reason: String(item.reason || '').slice(0, 500),
      basis: 'AI语义建议',
      status: '待确认',
      routeType: projectName ? '项目' : '无法判断',
    };
  }).filter((item) => item.messageId && (!allowedMessageIds || allowedMessageIds.has(item.messageId)));
}

export async function safeSemanticSuggestions(analyzer, input, onError = () => {}) {
  try {
    return await analyzer.analyze(input);
  } catch (error) {
    onError(error);
    return [];
  }
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.routes || parsed.items || [];
}

export class SemanticRoutingAnalyzer {
  constructor({ apiKey, baseUrl = 'https://api.deepseek.com', model = 'deepseek-chat', fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(Number(timeoutMs) || 60_000, 1);
  }

  async analyze(input) {
    if (!this.apiKey) return [];
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是项目消息路由器。只输出 JSON：{"routes": [...] }。' },
          { role: 'user', content: buildRoutingPrompt(input) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`semantic routing failed: HTTP ${response.status}`);
    const payload = await response.json();
    const items = extractJson(payload?.choices?.[0]?.message?.content);
    return normalizeSemanticSuggestions(
      items,
      new Set((input.projects || []).map((project) => project.name)),
      new Set((input.messages || []).map((message) => message.message_id || message.messageId).filter(Boolean)),
    );
  }
}
