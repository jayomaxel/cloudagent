import test from "node:test";
import assert from "node:assert/strict";

import {
  filterQueueForCurrentReviews,
  shouldEscalatePeriodicVerification,
} from "../src/periodic-reports.js";

test("periodic reports exclude queue entries from unrelated reviews", () => {
  const queue = [
    { record_id: "q1", fields: { 审核ID: "R-1" } },
    { record_id: "q2", fields: { 审核ID: "R-old" } },
  ];
  assert.deepEqual(filterQueueForCurrentReviews(queue, ["R-1"]).map((row) => row.record_id), ["q1"]);
});

test("periodic report model failures and conflicts require human review", () => {
  assert.equal(shouldEscalatePeriodicVerification(null), true);
  assert.equal(shouldEscalatePeriodicVerification({ verdict: "human_review", risk_level: "中", conflicts: [] }), true);
  assert.equal(shouldEscalatePeriodicVerification({ verdict: "auto_pass", risk_level: "高", conflicts: [] }), true);
  assert.equal(shouldEscalatePeriodicVerification({ verdict: "auto_pass", risk_level: "低", conflicts: [] }), false);
});

