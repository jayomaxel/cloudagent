import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_SCHEMA, FIELD_ADDITIONS, computeMigrationPlan } from "../src/migration-plan.js";

test("v0.6 migration contains monitoring and governed conclusion tables", () => {
  for (const table of ["Agent 运行状态", "Agent 群监听状态", "Agent 运行事件", "Agent 结论证据链"]) {
    assert.ok(AGENT_SCHEMA[table], `${table} is missing`);
  }
  assert.ok(FIELD_ADDITIONS["Agent 贡献证据"].some((field) => field.name === "结论层级"));
  const snapshot = { tables: Object.fromEntries(Object.entries(AGENT_SCHEMA).map(([name, fields]) => [name, fields.map((field) => field.name)])) };
  for (const [name, fields] of Object.entries(FIELD_ADDITIONS)) snapshot.tables[name] = fields.map((field) => field.name);
  const plan = computeMigrationPlan(snapshot);
  assert.equal(plan.createTables.length, 0);
  assert.equal(plan.addFields.length, 0);
});
