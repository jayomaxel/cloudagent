import test from "node:test";
import assert from "node:assert/strict";

import {
  filterConfirmedRelatedEvidence,
  isTerminalHumanDecision,
  nextReviewRetryState,
  parseReviewRetryAt,
  shouldRunAutomaticWrite,
} from "../src/review-workflow.js";

test("only confirmed evidence from the same period, member and project is related", () => {
  const rows = [
    { record_id: "ok", fields: { 审核状态: "已确认", 成员姓名: "甲", 项目: "A", 周期开始: "2026-08-03", 周期结束: "2026-08-09" } },
    { record_id: "draft", fields: { 审核状态: "待确认", 成员姓名: "甲", 项目: "A", 周期开始: "2026-08-03", 周期结束: "2026-08-09" } },
    { record_id: "old", fields: { 审核状态: "已确认", 成员姓名: "甲", 项目: "A", 周期开始: "2026-07-27", 周期结束: "2026-08-02" } },
    { record_id: "other", fields: { 审核状态: "已确认", 成员姓名: "乙", 项目: "A", 周期开始: "2026-08-03", 周期结束: "2026-08-09" } },
  ];
  assert.deepEqual(filterConfirmedRelatedEvidence(rows, {
    memberName: "甲",
    projectName: "A",
    periodStart: "2026-08-03",
    periodEnd: "2026-08-09",
  }).map((row) => row.record_id), ["ok"]);
});

test("review retries are bounded and use the configured backoff", () => {
  const now = Date.parse("2026-08-10T00:00:00Z");
  assert.deepEqual(nextReviewRetryState({ previousAttempts: 0, now }), {
    attempts: 1,
    retryAt: now + 60_000,
    exhausted: false,
  });
  assert.equal(nextReviewRetryState({ previousAttempts: 4, now }).exhausted, true);
});

test("timezone-less Feishu retry timestamps are parsed as Shanghai time", () => {
  assert.equal(parseReviewRetryAt("2026-08-10 12:31:15"), Date.parse("2026-08-10T12:31:15+08:00"));
});

test("non-terminal human decisions remain pending", () => {
  assert.equal(isTerminalHumanDecision("暂缓"), false);
  assert.equal(isTerminalHumanDecision("要求补充"), false);
  assert.equal(isTerminalHumanDecision("调整项目"), true);
  assert.equal(isTerminalHumanDecision("标记共同贡献"), true);
});

test("auto-write feature switch is enforced", () => {
  assert.equal(shouldRunAutomaticWrite({ autoWriteVerified: false }, { allowAutoWrite: true }), false);
  assert.equal(shouldRunAutomaticWrite({ autoWriteVerified: true }, { allowAutoWrite: true }), true);
});
