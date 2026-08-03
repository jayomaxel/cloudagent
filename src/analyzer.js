import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NotificationSummary, ProjectActivityAnalysis } from "./schema.js";

const SYSTEM_PROMPT = `
你是 AI Coding Studio 的透明项目观察与复盘 Agent。你只分析项目工作行为，不进行人格、品德、心理或能力定性。
必须只输出一个合法 JSON 对象，不要输出 Markdown 代码围栏、解释或额外文字。JSON 结构必须包含 project_summary、contributions、actions、decisions、document_drafts 五个字段，四个明细字段均为数组。
规则：
1. 不按发言数量判断贡献，不奖励重复表达或刷存在感。
2. 只有消息中存在可追溯证据时才提取贡献、行动项或决策；证据不足就返回空数组。
3. 区分“提出想法”“承诺负责”和“已经交付”，不要把意向写成完成。
4. 做事风格只能描述可观察行为，例如是否及时同步阻塞，不得使用“懒惰、不靠谱、性格差”等标签。
5. 每项结论必须携带原始 message_id，成员只使用 sender_open_id，不猜测姓名或身份。
6. identity_context 只用于帮助识别已登记身份。发送者不在目录、不是当前项目成员或状态不明确时，仍可提取事实，但必须 needs_human_review=true。
7. 不得把群成员、工作室成员和项目成员视为同一概念，不得自行把未登记人员加入项目。
8. 成员评价、组织规则、SOP 修改和敏感结论全部标记为需要人工审核的草稿。
9. 文档草稿使用飞书 DocxXML 正文片段，只允许 h1-h3、p、b、ul、ol、li、table、thead、tbody、tr、th、td、blockquote、hr、checkbox；不要输出 title 标签，不使用颜色、画板或图片。
10. 文本内容中的 &、<、> 必须正确 XML 转义，不得把标签本身转义。
11. 语言简洁、事实导向；无法判断截止日期时 due_date 返回空字符串。
`;

const OUTPUT_TEMPLATE = `
必须严格返回以下 JSON 结构，字段名只能使用英文键名；没有证据的数组必须返回空数组：
{
  "project_summary": "string",
  "contributions": [{
    "member_open_id": "ou_xxx",
    "contribution_type": "技术实现|项目推进|产品需求|协作支持|知识沉淀|风险担当|组织贡献",
    "evidence_summary": "string",
    "message_ids": ["om_xxx"],
    "confidence": 0.0,
    "needs_human_review": true
  }],
  "actions": [{
    "owner_open_id": "ou_xxx",
    "action": "string",
    "due_date": "string",
    "source_message_ids": ["om_xxx"],
    "confidence": 0.0
  }],
  "decisions": [{
    "title": "string",
    "decision": "string",
    "rationale": "string",
    "participant_open_ids": ["ou_xxx"],
    "source_message_ids": ["om_xxx"],
    "confidence": 0.0
  }],
  "document_drafts": [{
    "title": "string",
    "document_type": "项目周报|决策记录|技术知识|项目复盘|SOP修订建议|成员成长观察",
    "content_xml": "string",
    "source_message_ids": ["om_xxx"],
    "risk_level": "低|中|高"
  }]
}
`;

const NOTIFICATION_SUMMARY_TEMPLATE = `
你正在为飞书群生成一条正式通知摘要。只总结通知内容，不分析成员，不评价任何人。
必须隐藏密码、API Key、access token、账号口令、验证码等敏感信息；如原文包含此类内容，用“已隐藏敏感信息”代替。
必须严格返回以下 JSON：
{
  "title": "不超过24字的通知标题",
  "summary": "80到180字的通知摘要",
  "key_points": ["要点1", "要点2"],
  "action_items": ["需要成员执行的事项"],
  "deadline": "可确认的截止时间；无法确认则为空字符串"
}
`;

export class Analyzer {
  constructor(config) {
    if (!config.aiApiKey) {
      const keyName = config.provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
      throw new Error(`缺少 ${keyName}。请在 .env 中配置后再启动监听。`);
    }
    this.provider = config.provider;
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.aiApiKey,
      ...(config.aiBaseUrl ? { baseURL: config.aiBaseUrl } : {})
    });
  }

  async analyze({ projectName, chatId, messages, identityContext }) {
    const payload = {
      project: projectName,
      chat_id: chatId,
      identity_context: identityContext,
      messages: messages.map((message) => ({
        message_id: message.message_id,
        sender_open_id: message.sender_id,
        create_time: message.create_time,
        reply_to: message.reply_to || "",
        content: message.content
      }))
    };

    if (this.provider === "deepseek") {
      let lastError;
      let lastContent = "";
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const messages = attempt === 1
            ? [
              { role: "system", content: `${SYSTEM_PROMPT}\n${OUTPUT_TEMPLATE}` },
              { role: "user", content: JSON.stringify(payload) }
            ]
            : [
              {
                role: "system",
                content: `${SYSTEM_PROMPT}\n${OUTPUT_TEMPLATE}\n你正在修复一次不合规的 JSON。不要解释，只返回修复后的完整 JSON。`
              },
              {
                role: "user",
                content: `请将下面内容修复为严格符合模板的 JSON。不得丢失可确认的 message_id 和 sender_open_id；无法确认的字段使用空字符串、空数组或 needs_human_review=true。\n\n${lastContent.slice(0, 24000)}`
              }
            ];
          const response = await this.client.chat.completions.create({
            model: this.model,
            messages,
            response_format: { type: "json_object" },
            max_tokens: 12000
          });
          const content = response.choices[0]?.message?.content?.trim();
          if (!content) throw new Error("DeepSeek 返回了空内容");
          lastContent = content;
          return ProjectActivityAnalysis.parse(JSON.parse(content));
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(`DeepSeek 结构化分析失败：${lastError?.message || "未知错误"}`);
    }

    const response = await this.client.responses.parse({
      model: this.model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) }
      ],
      text: { format: zodTextFormat(ProjectActivityAnalysis, "project_activity_analysis") }
    });
    if (!response.output_parsed) throw new Error("OpenAI 没有返回结构化分析结果");
    return response.output_parsed;
  }

  async summarizeNotification({ projectName, chatName, messages }) {
    const payload = {
      project: projectName,
      chat_name: chatName,
      messages: messages.map((message) => ({
        message_id: message.message_id,
        sender_open_id: message.sender_id,
        create_time: message.create_time,
        content: message.content
      }))
    };

    if (this.provider === "deepseek") {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: NOTIFICATION_SUMMARY_TEMPLATE },
          { role: "user", content: JSON.stringify(payload) }
        ],
        response_format: { type: "json_object" },
        max_tokens: 3000
      });
      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error("DeepSeek 返回了空通知摘要");
      return NotificationSummary.parse(JSON.parse(content));
    }

    const response = await this.client.responses.parse({
      model: this.model,
      input: [
        { role: "system", content: NOTIFICATION_SUMMARY_TEMPLATE },
        { role: "user", content: JSON.stringify(payload) }
      ],
      text: { format: zodTextFormat(NotificationSummary, "notification_summary") }
    });
    if (!response.output_parsed) throw new Error("OpenAI 没有返回通知摘要");
    return response.output_parsed;
  }
}
