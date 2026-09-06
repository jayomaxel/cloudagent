import test from "node:test";
import assert from "node:assert/strict";

import {
  assertAcceptedFacts,
  isRollbackSnapshotSafe,
} from "../src/auto-write.js";

test("automatic writes reject reviews without accepted facts", () => {
  assert.throws(() => assertAcceptedFacts([], { humanOverride: false }), /accepted fact/i);
  assert.doesNotThrow(() => assertAcceptedFacts([], { humanOverride: true }));
});

test("rollback refuses to overwrite target data changed after the Agent write", () => {
  const after = { 状态: "已确认", 说明: "Agent 写入", 复杂字段: [{ id: "u1" }] };
  assert.equal(isRollbackSnapshotSafe(after, { 状态: "已确认", 说明: "Agent 写入", 复杂字段: [{ id: "u2" }] }), true);
  assert.equal(isRollbackSnapshotSafe(after, { 状态: "人工已修改", 说明: "Agent 写入" }), false);
});

