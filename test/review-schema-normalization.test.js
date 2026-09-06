import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePeriodicNarrative,
  normalizePeriodicVerification,
  normalizeWeeklyExtraction,
  normalizeWeeklyVerification,
  PeriodicNarrative,
  PeriodicVerification,
  WeeklyExtraction,
  WeeklyVerification,
} from "../src/review-schema.js";

test("DeepSeek English extraction fields are conservatively normalized", () => {
  const normalized = normalizeWeeklyExtraction({
    facts: [{ type: "progress", content: "完成安全复核", claim_level: "self_report" }],
  });
  const parsed = WeeklyExtraction.parse(normalized);
  assert.equal(parsed.summary, "完成安全复核");
  assert.equal(parsed.facts[0].type, "进展");
  assert.equal(parsed.facts[0].claim_level, "自述");
});

test("unknown verification labels fall back to human review and conservative grades", () => {
  const parsed = WeeklyVerification.parse(normalizeWeeklyVerification({ verdict: "unknown", evidence_grade: "gold", risk_level: "unknown" }));
  assert.equal(parsed.verdict, "human_review");
  assert.equal(parsed.evidence_grade, "C");
  assert.equal(parsed.risk_level, "中");
});

test("Chinese periodic report fields and scalar lists are normalized", () => {
  const parsed = PeriodicNarrative.parse(normalizePeriodicNarrative({ 标题: "周报", 总结: "进展稳定", 亮点: "完成复核", 风险: ["等待确认"], 下一步: "继续测试" }));
  assert.equal(parsed.title, "周报");
  assert.deepEqual(parsed.highlights, ["完成复核"]);
  assert.deepEqual(parsed.next_actions, ["继续测试"]);
});

test("periodic verification defaults to human review unless pass is explicit", () => {
  assert.equal(PeriodicVerification.parse(normalizePeriodicVerification({ 审核结论: "通过", 风险等级: "低", 理由: "内容一致" })).verdict, "auto_pass");
  assert.equal(PeriodicVerification.parse(normalizePeriodicVerification({ 审核结论: "未知" })).verdict, "human_review");
});
