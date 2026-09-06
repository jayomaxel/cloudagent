import { createHash } from "node:crypto";

export const REVIEW_STATUS = Object.freeze({
  AUTO: "自动通过",
  SUPPLEMENT: "待补充",
  HUMAN: "人工审核",
  DUPLICATE: "驳回重复",
  FAILED: "处理失败",
  HISTORY: "历史待处理"
});

export const RISK_LEVEL = Object.freeze({ LOW: "低", MEDIUM: "中", HIGH: "高" });
export const EVIDENCE_GRADE = Object.freeze({ A: "A", B: "B", C: "C", D: "D" });

const EVIDENCE_GRADE_SCORE = Object.freeze({ A: 4, B: 3, C: 2, D: 1 });

export function selfReportedEvidenceStrength() {
  return 0;
}

export function conservativeEvidenceGrade(deterministicGrade = EVIDENCE_GRADE.C, modelGrade = EVIDENCE_GRADE.C) {
  const deterministic = EVIDENCE_GRADE_SCORE[deterministicGrade] ?? EVIDENCE_GRADE_SCORE.C;
  const model = EVIDENCE_GRADE_SCORE[modelGrade] ?? EVIDENCE_GRADE_SCORE.C;
  return deterministic <= model ? deterministicGrade : modelGrade;
}

export function hasAcceptedFacts(verification, factCount) {
  const indexes = Array.isArray(verification?.accepted_fact_indexes) ? verification.accepted_fact_indexes : [];
  return indexes.some((index) => Number.isInteger(index) && index >= 0 && index < factCount);
}

const SENSITIVE_PATTERNS = [
  ["密钥", /(?:api[_ -]?key|access[_ -]?token|secret|password|passwd|密码|密钥)\s*[:=]\s*\S+/i],
  ["环境变量", /(?:^|\s)\.env(?:\s|$)|OPENAI_API_KEY|DEEPSEEK_API_KEY/i],
  ["联系方式", /(?:\+?86[- ]?)?1[3-9]\d{9}/]
];

const HIGH_RISK_PATTERNS = [
  /删除(?:文件|数据|记录|表)/,
  /数据库(?:迁移|清空|覆盖|回滚)/,
  /生产(?:部署|发布|环境)/,
  /修改\s*\.env|环境变量/,
  /权限(?:变更|提升|管理员)/,
  /公共(?:账号|额度|资源)/,
  /密钥|token|api\s*key/i,
  /批量(?:替换|覆盖|删除)/
];

const EVALUATION_PATTERNS = [
  /性格|人品|品德|心理|能力差|懒惰|不靠谱|责任意识|执行能力/,
  /工作风格|成员评价|淘汰|处分/
];

export function stableId(prefix, parts) {
  const normalized = (Array.isArray(parts) ? parts : [parts])
    .map((item) => String(item ?? "").trim().replace(/\s+/g, " "))
    .join("\u001f");
  return `${prefix}_${createHash("sha256").update(normalized).digest("hex").slice(0, 32)}`;
}

export function extractUrls(text) {
  return [...new Set(String(text || "").match(/https?:\/\/[^\s<>()]+/gi) || [])];
}

export function scanSensitiveText(text) {
  const value = String(text || "");
  return SENSITIVE_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

export function scanRiskSignals(text) {
  const value = String(text || "");
  return {
    highRisk: HIGH_RISK_PATTERNS.some((pattern) => pattern.test(value)),
    sensitiveEvaluation: EVALUATION_PATTERNS.some((pattern) => pattern.test(value)),
    sensitiveTypes: scanSensitiveText(value)
  };
}

export function evidenceGrade({ artifactCount = 0, artifactsVerified = false, independentSources = 0, ownerConfirmed = false, inference = false, conflict = false } = {}) {
  if (inference || conflict) return EVIDENCE_GRADE.D;
  if (ownerConfirmed || (artifactsVerified && artifactCount > 0)) return EVIDENCE_GRADE.A;
  if (independentSources >= 2) return EVIDENCE_GRADE.B;
  return EVIDENCE_GRADE.C;
}

export function runDeterministicChecks(candidate, { existingFactIds = [] } = {}) {
  const errors = [];
  const warnings = [];
  if (!candidate?.recordId) errors.push("缺少来源记录ID");
  if (!candidate?.memberOpenId) errors.push("成员身份无法确认");
  if (candidate?.projectCandidate && !candidate?.projectName) errors.push("项目归属无法确认");
  if (!candidate?.periodStart || !candidate?.periodEnd) errors.push("周期范围无法确认");
  if (!candidate?.summaryText) errors.push("问卷没有可审核内容");

  const signals = scanRiskSignals(candidate?.summaryText);
  if (signals.sensitiveTypes.length) warnings.push(`包含敏感信息：${signals.sensitiveTypes.join("、")}`);
  if (signals.sensitiveEvaluation) warnings.push("包含敏感成员评价");
  const duplicate = existingFactIds.includes(candidate?.factId);
  if (duplicate) warnings.push("事实ID已存在");

  const grade = evidenceGrade({
    artifactCount: candidate?.verifiedArtifactCount || 0,
    artifactsVerified: Boolean(candidate?.verifiedArtifactCount),
    independentSources: candidate?.independentSources || 0,
    ownerConfirmed: Boolean(candidate?.ownerConfirmed),
    inference: Boolean(candidate?.inference),
    conflict: Boolean(candidate?.conflict)
  });
  const riskLevel = signals.highRisk || signals.sensitiveTypes.length
    ? RISK_LEVEL.HIGH
    : signals.sensitiveEvaluation || errors.length
      ? RISK_LEVEL.MEDIUM
      : RISK_LEVEL.LOW;

  return { errors, warnings, duplicate, evidenceGrade: grade, riskLevel, ...signals };
}

export function decideReviewOutcome({ checks, extraction = {}, verification = {}, humanOverride = false } = {}) {
  if (checks?.duplicate) return { status: REVIEW_STATUS.DUPLICATE, allowFormalWrite: false, needsHumanReview: false };
  if (humanOverride) return { status: REVIEW_STATUS.AUTO, allowFormalWrite: true, needsHumanReview: false };
  const conflict = Boolean(extraction.conflict || verification.conflict || verification.conflicts?.length);
  const sensitiveEvaluation = checks?.sensitiveEvaluation || extraction.contains_sensitive_evaluation;
  const highRisk = checks?.riskLevel === RISK_LEVEL.HIGH || verification.risk_level === RISK_LEVEL.HIGH;
  if (checks?.errors?.length || conflict || sensitiveEvaluation || highRisk || verification.verdict === "human_review") {
    return { status: REVIEW_STATUS.HUMAN, allowFormalWrite: false, needsHumanReview: true };
  }
  if (verification.verdict === "reject_duplicate") {
    return { status: REVIEW_STATUS.DUPLICATE, allowFormalWrite: false, needsHumanReview: false };
  }
  const grade = conservativeEvidenceGrade(
    checks?.evidenceGrade || EVIDENCE_GRADE.C,
    verification.evidence_grade || EVIDENCE_GRADE.C
  );
  if (![EVIDENCE_GRADE.A, EVIDENCE_GRADE.B].includes(grade) || verification.verdict === "needs_supplement") {
    return { status: REVIEW_STATUS.SUPPLEMENT, allowFormalWrite: false, needsHumanReview: true, evidenceGrade: grade };
  }
  if (!hasAcceptedFacts(verification, extraction?.facts?.length || 0)) {
    return { status: REVIEW_STATUS.SUPPLEMENT, allowFormalWrite: false, needsHumanReview: true, evidenceGrade: grade };
  }
  if (verification.verdict !== "auto_pass") {
    return { status: REVIEW_STATUS.HUMAN, allowFormalWrite: false, needsHumanReview: true };
  }
  return { status: REVIEW_STATUS.AUTO, allowFormalWrite: true, needsHumanReview: false, evidenceGrade: grade };
}

export function buildReviewId(recordId, weekKey) {
  return stableId("review", [recordId, weekKey]);
}

export function buildWriteOperationId(reviewId, target, action = "write") {
  return stableId("write", [reviewId, target, action]);
}
