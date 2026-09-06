import test from "node:test";
import assert from "node:assert/strict";
import { AutoWriteService } from "../src/auto-write.js";

test("auto writer refuses unapproved reviews", () => {
  const gateway = { findByField: () => null };
  const service = new AutoWriteService({ gateway, config: { tables: {} } });
  const result = service.applyVerifiedReview({ candidate: {}, extraction: {}, verification: {}, outcome: { status: "待补充", allowFormalWrite: false } });
  assert.deepEqual(result, []);
});

test("member growth update preserves existing text", () => {
  const records = new Map();
  const gateway = {
    findByField: (table, field, value) => records.get(value) || null,
    createRecords: (table, rows) => { const id = rows[0]["操作ID"] || rows[0]["事实ID"] || `created-${records.size}`; records.set(id, { record_id: id, fields: rows[0] }); return { recordIds: [id] }; },
    updateRecords: (table, updates) => { for (const [id, fields] of Object.entries(updates)) { const current = records.get(id) || { record_id: id, fields: {} }; current.fields = { ...current.fields, ...fields }; records.set(id, current); } },
    getRecord: () => ({ fields: { "成长记录": "原有内容" } })
  };
  const service = new AutoWriteService({ gateway, config: { agentVersion: "0.7.0", tables: {} } });
  service.applyVerifiedReview({
    candidate: { reviewId: "r1", factId: "f1", memberRecordId: "m1", memberOpenId: "ou1", memberName: "成员", weekKey: "w1", periodStart: "2026-08-03", periodEnd: "2026-08-09", links: [], independentSources: 2, projectName: "A" },
    extraction: { summary: "完成接口", facts: [{ text: "完成接口", contribution_type: "技术实现" }], contribution_claim: false },
    verification: { rationale: "证据充分", accepted_fact_indexes: [0] },
    outcome: { status: "自动通过", allowFormalWrite: true }
  });
  assert.match(records.get("m1").fields["成长记录"], /原有内容/);
  assert.match(records.get("m1").fields["成长记录"], /完成接口/);
});
