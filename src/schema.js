import { z } from "zod";

const contributionTypes = [
  "技术实现",
  "项目推进",
  "产品需求",
  "协作支持",
  "知识沉淀",
  "风险担当",
  "组织贡献"
];

const documentTypes = [
  "项目周报",
  "项目月报",
  "决策记录",
  "技术知识",
  "项目复盘",
  "SOP修订建议",
  "成员成长观察"
];

const topicTypes = [
  "进展同步",
  "问题卡点",
  "待办推进",
  "决策讨论",
  "资源协调",
  "知识沉淀",
  "风险提醒",
  "综合讨论"
];

const claimLevels = ["事实", "推断"];
const workStyleDimensions = ["进度同步", "承诺兑现", "协作支持", "风险意识", "问题澄清", "纠错与学习", "项目推进"];

export const ProjectActivityAnalysis = z.object({
  project_summary: z.string(),
  topic_snapshots: z.array(z.object({
    title: z.string(),
    topic_type: z.enum(topicTypes),
    one_sentence_summary: z.string(),
    progress_points: z.array(z.string()),
    blockers: z.array(z.string()),
    action_items: z.array(z.string()),
    pending_questions: z.array(z.string()),
    suggestions: z.array(z.string()),
    related_open_ids: z.array(z.string()),
    source_message_ids: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    needs_human_review: z.boolean(),
    claim_level: z.enum(claimLevels).default("推断"),
    evidence_reason: z.string().default("")
  })).default([]),
  contributions: z.array(z.object({
    member_open_id: z.string(),
    contribution_type: z.enum(contributionTypes),
    evidence_summary: z.string(),
    message_ids: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    needs_human_review: z.boolean(),
    claim_level: z.enum(claimLevels).default("推断"),
    evidence_reason: z.string().default("")
  })),
  actions: z.array(z.object({
    owner_open_id: z.string(),
    action: z.string(),
    due_date: z.string(),
    source_message_ids: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    needs_human_review: z.boolean().default(true),
    claim_level: z.enum(claimLevels).default("推断"),
    evidence_reason: z.string().default("")
  })),
  decisions: z.array(z.object({
    title: z.string(),
    decision: z.string(),
    rationale: z.string(),
    participant_open_ids: z.array(z.string()),
    source_message_ids: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    needs_human_review: z.boolean().default(true),
    claim_level: z.enum(claimLevels).default("推断"),
    evidence_reason: z.string().default("")
  })),
  work_style_observations: z.array(z.object({
    member_open_id: z.string(),
    dimension: z.enum(workStyleDimensions),
    observation: z.string(),
    source_claim_ids: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    needs_human_review: z.literal(true)
  })).default([]),
  document_drafts: z.array(z.object({
    title: z.string(),
    document_type: z.enum(documentTypes),
    content_xml: z.string(),
    source_message_ids: z.array(z.string()),
    risk_level: z.enum(["低", "中", "高"])
  }))
});

export const WorkStyleEvaluationBatch = z.object({
  observations: z.array(z.object({
    member_open_id: z.string(),
    dimension: z.enum(workStyleDimensions),
    observation: z.string(),
    source_claim_ids: z.array(z.string()).min(3),
    confidence: z.number().min(0).max(1),
    needs_human_review: z.literal(true)
  }))
});

export const NotificationSummary = z.object({
  title: z.string(),
  summary: z.string(),
  key_points: z.array(z.string()),
  action_items: z.array(z.string()),
  deadline: z.string()
});
