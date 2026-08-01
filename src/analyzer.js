import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ProjectActivityAnalysis } from "./schema.js";

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
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const response = await this.client.chat.completions.create({
            model: this.model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: JSON.stringify(payload) }
            ],
            response_format: { type: "json_object" },
            max_tokens: 12000
          });
          const content = response.choices[0]?.message?.content?.trim();
          if (!content) throw new Error("DeepSeek 返回了空内容");
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
}
