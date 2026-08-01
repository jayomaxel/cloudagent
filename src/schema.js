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
  "决策记录",
  "技术知识",
  "项目复盘",
  "SOP修订建议",
  "成员成长观察"
];

export const ProjectActivityAnalysis = z.object({
  project_summary: z.string(),
  contributions: z.array(z.object({
    member_open_id: z.string(),
    contribution_type: z.enum(contributionTypes),
    evidence_summary: z.string(),
    message_ids: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    needs_human_review: z.boolean()
  })),
  actions: z.array(z.object({
    owner_open_id: z.string(),
    action: z.string(),
    due_date: z.string(),
    source_message_ids: z.array(z.string()),
    confidence: z.number().min(0).max(1)
  })),
  decisions: z.array(z.object({
    title: z.string(),
    decision: z.string(),
    rationale: z.string(),
    participant_open_ids: z.array(z.string()),
    source_message_ids: z.array(z.string()),
    confidence: z.number().min(0).max(1)
  })),
  document_drafts: z.array(z.object({
    title: z.string(),
    document_type: z.enum(documentTypes),
    content_xml: z.string(),
    source_message_ids: z.array(z.string()),
    risk_level: z.enum(["低", "中", "高"])
  }))
});
