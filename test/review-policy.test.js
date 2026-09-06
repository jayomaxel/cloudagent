import test from "node:test";
import assert from "node:assert/strict";
import { decideReviewOutcome, evidenceGrade, runDeterministicChecks } from "../src/review-policy.js";

const candidate = { recordId: "rec1", memberOpenId: "ou1", projectName: "AIMI智能体", projectCandidate: "AIMI", periodStart: "2026-08-03", periodEnd: "2026-08-09", summaryText: "完成接口并提交 https://example.com/pr/1", links: ["https://example.com/pr/1"], factId: "fact1" };

test("evidence grade follows A B C D boundaries", () => {
  assert.equal(evidenceGrade({ artifactCount: 1, artifactsVerified: true }), "A");
  assert.equal(evidenceGrade({ independentSources: 2 }), "B");
  assert.equal(evidenceGrade({}), "C");
  assert.equal(evidenceGrade({ conflict: true }), "D");
});

test("high-risk operations always require human review", () => {
  const checks = runDeterministicChecks({ ...candidate, summaryText: "准备删除数据库并修改.env" });
  const outcome = decideReviewOutcome({ checks, verification: { verdict: "auto_pass", evidence_grade: "A", risk_level: "低" } });
  assert.equal(checks.riskLevel, "高");
  assert.equal(outcome.status, "人工审核");
});

test("confidence is not an auto-pass criterion", () => {
  const checks = runDeterministicChecks({ ...candidate, links: [], independentSources: 0 });
  const outcome = decideReviewOutcome({ checks, verification: { verdict: "auto_pass", evidence_grade: "C", risk_level: "低", confidence: 1 } });
  assert.equal(outcome.status, "待补充");
});

test("duplicate facts do not call for human review", () => {
  const checks = runDeterministicChecks(candidate, { existingFactIds: ["fact1"] });
  assert.equal(decideReviewOutcome({ checks }).status, "驳回重复");
});
