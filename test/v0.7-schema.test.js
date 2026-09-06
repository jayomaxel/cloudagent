import test from "node:test";
import assert from "node:assert/strict";
import { computeV07Migration, V07_SCHEMA, WEEKLY_FIELD_ADDITIONS } from "../src/v0.7-schema.js";

test("v0.7 migration is additive and contains governance tables", () => {
  const plan = computeV07Migration({ "成员周成长记录": ["姓名"] });
  assert.deepEqual(Object.keys(V07_SCHEMA), ["Agent AI审核记录", "Agent 负责人审核队列", "Agent 自动写入日志", "Agent 周期报告"]);
  assert.equal(plan.destructiveChanges.length, 0);
  assert.equal(plan.addFields.some((item) => item.field.name === "AI审核状态"), true);
});

test("v0.7 migration is idempotent", () => {
  const snapshot = Object.fromEntries(Object.entries(V07_SCHEMA).map(([name, fields]) => [name, fields.map((field) => field.name)]));
  snapshot["成员周成长记录"] = WEEKLY_FIELD_ADDITIONS.map((field) => field.name);
  const plan = computeV07Migration(snapshot);
  assert.equal(plan.createTables.length, 0);
  assert.equal(plan.addFields.length, 0);
});

