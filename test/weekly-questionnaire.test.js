import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWeeklySubmission, shanghaiWeekBounds } from "../src/weekly-questionnaire.js";

test("normalizes the existing weekly questionnaire fields", () => {
  const candidate = normalizeWeeklySubmission({ record_id: "rec1", fields: { "姓名": "焦雪晴", "当前项目或学习主题": "AIMI", "本周具体工作&解决了什么问题": "完成接口 https://example.com/pr", "提交时间": "2026-08-09 12:00:00" } }, {
    members: [{ openId: "ou1", name: "焦雪晴", recordId: "member1" }],
    projects: [{ name: "AIMI智能体", aliases: ["AIMI"], recordId: "project1" }]
  });
  assert.equal(candidate.memberOpenId, "ou1");
  assert.equal(candidate.projectName, "AIMI智能体");
  assert.equal(candidate.links.length, 1);
  assert.equal(candidate.periodStart, "2026-08-03");
});

test("natural week is Monday through Sunday in Shanghai", () => {
  assert.deepEqual(shanghaiWeekBounds("2026-08-05 08:00:00"), { start: "2026-08-03", end: "2026-08-09", key: "2026-08-03_2026-08-09" });
});

