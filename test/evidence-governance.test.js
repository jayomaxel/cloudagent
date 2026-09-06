import test from "node:test";
import assert from "node:assert/strict";
import { canLinkEvaluationToMember, claimReviewStatus, deriveEvidence, validateWorkStyleObservation } from "../src/evidence-governance.js";

test("evidence keeps only real source messages and derives links and time range", () => {
  const evidence = deriveEvidence(["m2", "invented", "m1", "m2"], [
    { message_id: "m1", create_time: "2026-08-01T09:00:00Z", message_app_link: "https://example/m1" },
    { message_id: "m2", create_time: "2026-08-01T10:00:00Z", message_app_link: "https://example/m2" }
  ]);
  assert.deepEqual(evidence.ids, ["m2", "m1"]);
  assert.equal(evidence.count, 2);
  assert.equal(evidence.startedAt, "2026-08-01T09:00:00.000Z");
  assert.equal(evidence.endedAt, "2026-08-01T10:00:00.000Z");
  assert.equal(deriveEvidence(["invented"], []), null);
});

test("inferences and evaluations always require review", () => {
  assert.equal(claimReviewStatus("事实"), "自动确认");
  assert.equal(claimReviewStatus("事实", { identityRequiresReview: true }), "待审核");
  assert.equal(claimReviewStatus("推断"), "待审核");
  assert.equal(claimReviewStatus("评价"), "待审核");
});

test("work style evaluation needs three facts across two batches and formal mode", () => {
  const facts = [
    { claimId: "c1", batchId: "b1" },
    { claimId: "c2", batchId: "b1" },
    { claimId: "c3", batchId: "b2" }
  ];
  assert.ok(validateWorkStyleObservation({ source_claim_ids: ["c1", "c2", "c3"] }, facts));
  assert.equal(validateWorkStyleObservation({ source_claim_ids: ["c1", "c2"] }, facts), null);
  const row = { level: "评价", reviewStatus: "已确认", evidenceCount: 3, batchCount: 2 };
  assert.equal(canLinkEvaluationToMember(row, "shadow"), false);
  assert.equal(canLinkEvaluationToMember(row, "formal"), true);
});
