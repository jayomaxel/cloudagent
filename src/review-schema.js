import { z } from "zod";

const TYPE_ALIASES = new Map([
  ["progress", "进展"], ["update", "进展"], ["进展", "进展"],
  ["result", "成果"], ["outcome", "成果"], ["achievement", "成果"], ["成果", "成果"],
  ["problem", "问题"], ["issue", "问题"], ["risk", "问题"], ["问题", "问题"],
  ["decision", "判断"], ["judgment", "判断"], ["判断", "判断"],
  ["collaboration", "协作"], ["coordination", "协作"], ["协作", "协作"],
  ["plan", "计划"], ["nextstep", "计划"], ["计划", "计划"],
  ["aicollaboration", "AI协作"], ["aiusage", "AI协作"], ["ai协作", "AI协作"],
]);

const CLAIM_ALIASES = new Map([
  ["fact", "事实"], ["verified", "事实"], ["事实", "事实"],
  ["selfreport", "自述"], ["selfreported", "自述"], ["claim", "自述"], ["自述", "自述"],
  ["inference", "推断"], ["inferred", "推断"], ["推断", "推断"],
]);

function key(value) {
  return String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function strings(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

export function normalizeWeeklyExtraction(value = {}) {
  const rawFacts = Array.isArray(value.facts) ? value.facts : Array.isArray(value.items) ? value.items : [];
  const facts = rawFacts.map((fact) => ({
    type: TYPE_ALIASES.get(key(fact?.type || fact?.category)) || "进展",
    text: String(fact?.text || fact?.content || fact?.description || fact?.statement || "").trim(),
    claim_level: CLAIM_ALIASES.get(key(fact?.claim_level || fact?.claimLevel || fact?.evidence_level)) || "自述",
    evidence_refs: strings(fact?.evidence_refs || fact?.evidenceRefs || fact?.references),
    contribution_type: String(fact?.contribution_type || fact?.contributionType || ""),
  })).filter((fact) => fact.text);
  return {
    summary: String(value.summary || value.overview || value.conclusion || facts.map((fact) => fact.text).join("；")),
    facts,
    contribution_claim: Boolean(value.contribution_claim ?? value.contributionClaim),
    support_needed: String(value.support_needed || value.supportNeeded || ""),
    next_plan: String(value.next_plan || value.nextPlan || ""),
    conflict: Boolean(value.conflict),
    contains_sensitive_evaluation: Boolean(value.contains_sensitive_evaluation ?? value.containsSensitiveEvaluation),
    risk_signals: strings(value.risk_signals || value.riskSignals),
  };
}

export function normalizeWeeklyVerification(value = {}) {
  const verdictAliases = { pass: "auto_pass", approved: "auto_pass", supplement: "needs_supplement", review: "human_review", reject: "reject_duplicate" };
  const validVerdicts = ["auto_pass", "needs_supplement", "human_review", "reject_duplicate"];
  const riskAliases = { low: "低", medium: "中", high: "高", 低: "低", 中: "中", 高: "高" };
  const verdictKey = key(value.verdict);
  const grade = String(value.evidence_grade || value.evidenceGrade || "C").toUpperCase();
  return {
    verdict: validVerdicts.includes(value.verdict) ? value.verdict : verdictAliases[verdictKey] || "human_review",
    evidence_grade: ["A", "B", "C", "D"].includes(grade) ? grade : "C",
    risk_level: riskAliases[key(value.risk_level || value.riskLevel)] || "中",
    conflict: Boolean(value.conflict),
    conflicts: strings(value.conflicts),
    rationale: String(value.rationale || value.reason || "模型未提供审核理由"),
    accepted_fact_indexes: Array.isArray(value.accepted_fact_indexes || value.acceptedFactIndexes) ? (value.accepted_fact_indexes || value.acceptedFactIndexes).map(Number).filter(Number.isInteger) : [],
    rejected_fact_indexes: Array.isArray(value.rejected_fact_indexes || value.rejectedFactIndexes) ? (value.rejected_fact_indexes || value.rejectedFactIndexes).map(Number).filter(Number.isInteger) : [],
    supplement_request: String(value.supplement_request || value.supplementRequest || ""),
    suggested_action: String(value.suggested_action || value.suggestedAction || ""),
  };
}

export function normalizePeriodicNarrative(value = {}) {
  return {
    title: String(value.title || value["标题"] || "周期报告"),
    summary: String(value.summary || value["总结"] || value.overview || value["概述"] || value.content || value["内容"] || "保留确定性报告"),
    highlights: strings(value.highlights || value["亮点"] || value["重点"]),
    risks: strings(value.risks || value["风险"] || value["风险项"]),
    next_actions: strings(value.next_actions || value.nextActions || value["下一步"] || value["后续行动"]),
  };
}

export function normalizePeriodicVerification(value = {}) {
  const rawVerdict = key(value.verdict || value["结论"] || value["审核结论"]);
  const passValues = new Set(["autopass", "pass", "approved", "通过", "自动通过"]);
  const riskAliases = { low: "低", medium: "中", high: "高", 低: "低", 中: "中", 高: "高" };
  return {
    verdict: passValues.has(rawVerdict) ? "auto_pass" : "human_review",
    risk_level: riskAliases[key(value.risk_level || value.riskLevel || value["风险等级"])] || "中",
    conflicts: strings(value.conflicts || value["冲突"] || value["问题"]),
    rationale: String(value.rationale || value.reason || value["理由"] || value["审核说明"] || "模型未提供复核理由"),
  };
}

export const WeeklyExtraction = z.object({
  summary: z.string(),
  facts: z.array(z.object({
    type: z.enum(["进展", "成果", "问题", "判断", "协作", "计划", "AI协作"]),
    text: z.string(),
    claim_level: z.enum(["事实", "自述", "推断"]),
    evidence_refs: z.array(z.string()).default([]),
    contribution_type: z.string().default("")
  })).default([]),
  contribution_claim: z.boolean().default(false),
  support_needed: z.string().default(""),
  next_plan: z.string().default(""),
  conflict: z.boolean().default(false),
  contains_sensitive_evaluation: z.boolean().default(false),
  risk_signals: z.array(z.string()).default([])
});

export const WeeklyVerification = z.object({
  verdict: z.enum(["auto_pass", "needs_supplement", "human_review", "reject_duplicate"]),
  evidence_grade: z.enum(["A", "B", "C", "D"]),
  risk_level: z.enum(["低", "中", "高"]),
  conflict: z.boolean().default(false),
  conflicts: z.array(z.string()).default([]),
  rationale: z.string(),
  accepted_fact_indexes: z.array(z.number().int().nonnegative()).default([]),
  rejected_fact_indexes: z.array(z.number().int().nonnegative()).default([]),
  supplement_request: z.string().default(""),
  suggested_action: z.string().default("")
});

export const PeriodicNarrative = z.object({
  title: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  next_actions: z.array(z.string()).default([])
});

export const PeriodicVerification = z.object({
  verdict: z.enum(["auto_pass", "human_review"]),
  risk_level: z.enum(["低", "中", "高"]),
  conflicts: z.array(z.string()).default([]),
  rationale: z.string(),
});
