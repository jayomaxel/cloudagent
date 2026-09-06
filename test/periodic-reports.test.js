import test from "node:test";
import assert from "node:assert/strict";
import { buildMemberWeeklyReport, periodKey } from "../src/periodic-reports.js";

test("weekly period uses the previous natural week", () => {
  assert.deepEqual(periodKey("week", new Date("2026-08-10T01:00:00Z")), { type: "week", start: "2026-08-03", end: "2026-08-09", key: "2026-08-03_2026-08-09" });
});

test("report preserves verified, self-report, and pending boundaries", () => {
  const text = buildMemberWeeklyReport({
    name: "成员", period: { start: "2026-08-03", end: "2026-08-09" },
    submissions: [{ reviewStatus: "待补充", summary: "自述内容", support: "需要接口帮助" }],
    reviews: [{ status: "自动通过", summary: "已核验成果" }], queue: [{ status: "待审核", question: "贡献归属待确认" }]
  });
  assert.match(text, /已核验成果/);
  assert.match(text, /成员自述/);
  assert.match(text, /贡献归属待确认/);
});

