import test from "node:test";
import assert from "node:assert/strict";

import {
  conservativeEvidenceGrade,
  hasAcceptedFacts,
  selfReportedEvidenceStrength,
} from "../src/review-policy.js";

test("self-reported links and attachments are not independent evidence", () => {
  assert.equal(selfReportedEvidenceStrength({ links: ["https://example.com/demo"], attachmentCount: 2 }), 0);
});

test("model review cannot upgrade a deterministic evidence grade", () => {
  assert.equal(conservativeEvidenceGrade("C", "A"), "C");
  assert.equal(conservativeEvidenceGrade("B", "A"), "B");
  assert.equal(conservativeEvidenceGrade("A", "B"), "B");
});

test("automatic review requires at least one valid accepted fact", () => {
  assert.equal(hasAcceptedFacts({ accepted_fact_indexes: [] }, 3), false);
  assert.equal(hasAcceptedFacts({ accepted_fact_indexes: [1] }, 3), true);
  assert.equal(hasAcceptedFacts({ accepted_fact_indexes: [99] }, 3), false);
});

