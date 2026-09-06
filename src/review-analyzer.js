import OpenAI from "openai";
import {
  normalizeWeeklyExtraction,
  normalizeWeeklyVerification,
  normalizePeriodicNarrative,
  normalizePeriodicVerification,
  PeriodicNarrative,
  PeriodicVerification,
  WeeklyExtraction,
  WeeklyVerification,
} from "./review-schema.js";

const EXTRACTION_PROMPT = `
你是工作室每周问卷的事实提取 Agent。只整理输入中可追溯的内容，不评价人格、品德、心理或能力，不根据文字长度判断贡献。
区分“事实”“成员自述”“AI推断”。成果、完成、提交、决定等事实必须有 evidence_refs；没有独立证据时标记为“自述”。
只返回 JSON，字段必须符合约定结构。
`;

const VERIFICATION_PROMPT = `
你是独立审核 Agent。你必须重新检查原始问卷、确定性检查、相关证据和第一层提取结果，不得直接相信第一层结论。
只有 A/B 级、低风险、无冲突、身份与项目明确的事实可以 auto_pass。自述无独立证据应 needs_supplement。
贡献争议、成员评价、公共资源、密钥、生产部署、删除或覆盖数据必须 human_review。置信度不能单独决定通过。
只返回 JSON，字段必须符合约定结构。
`;

const REPORT_PROMPT = `
你是周期报告文字整理 Agent。只能改写已经给出的结构化事实，不得新增事实，不得删除证据标签，不得按消息数量评价贡献。
保留“已核验事实、成员自述、AI推断、待负责人确认”的边界，只返回 JSON。
`;

const REPORT_VERIFICATION_PROMPT = `
你是周期报告独立复核 Agent。逐项对照确定性报告与整理稿，检查是否新增事实、遗漏风险、混入其他周期或把成员自述写成已核验事实。
有任何冲突、证据边界变化、成员评价或高风险内容时必须 human_review；完全一致且低风险时才 auto_pass。只返回 JSON。
`;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  if (typeof value !== "string") return value;
  return value
    .replace(/(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, "[已隐藏密钥]")
    .replace(/((?:api[_ -]?key|access[_ -]?token|secret|password|密码|密钥)\s*[:=]\s*)\S+/gi, "$1[已隐藏敏感信息]")
    .replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g, "[已隐藏手机号]");
}

export class ReviewAnalyzer {
  constructor(config, { client, onTelemetry } = {}) {
    this.config = config;
    this.model = config.reviewModel || config.model;
    this.highRiskModel = config.highRiskReviewModel || this.model;
    this.onTelemetry = typeof onTelemetry === "function" ? onTelemetry : () => {};
    this.client = client || new OpenAI({
      apiKey: config.aiApiKey,
      ...(config.aiBaseUrl ? { baseURL: config.aiBaseUrl } : {}),
      timeout: Math.max(Number(config.reliability?.modelTimeoutSeconds) || 60, 5) * 1000,
      maxRetries: 0
    });
  }

  async callJson({ purpose, model, prompt, payload, schema, normalize = (value) => value }) {
    const startedAt = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: JSON.stringify(redact(payload)) }
        ],
        response_format: { type: "json_object" },
        max_tokens: 6000
      });
      const content = response.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error(`${purpose}返回空内容`);
      const parsed = schema.parse(normalize(JSON.parse(content)));
      this.onTelemetry({ purpose, model, success: true, usage: response.usage || {}, startedAt, endedAt: Date.now() });
      return parsed;
    } catch (error) {
      this.onTelemetry({ purpose, model, success: false, usage: {}, error, startedAt, endedAt: Date.now() });
      throw error;
    }
  }

  extractWeeklyCandidate(payload) {
    return this.callJson({ purpose: "每周问卷事实提取", model: this.model, prompt: EXTRACTION_PROMPT, payload, schema: WeeklyExtraction, normalize: normalizeWeeklyExtraction });
  }

  verifyWeeklyCandidate(payload, { highRisk = false } = {}) {
    return this.callJson({
      purpose: "每周问卷独立复核",
      model: highRisk ? this.highRiskModel : this.model,
      prompt: VERIFICATION_PROMPT,
      payload,
      schema: WeeklyVerification,
      normalize: normalizeWeeklyVerification
    });
  }

  polishPeriodicReport(payload) {
    return this.callJson({ purpose: "周期报告文字整理", model: this.model, prompt: REPORT_PROMPT, payload, schema: PeriodicNarrative, normalize: normalizePeriodicNarrative });
  }

  verifyPeriodicReport(payload) {
    return this.callJson({ purpose: "周期报告独立复核", model: this.highRiskModel, prompt: REPORT_VERIFICATION_PROMPT, payload, schema: PeriodicVerification, normalize: normalizePeriodicVerification });
  }
}

export function redactReviewPayload(value) {
  return redact(value);
}
