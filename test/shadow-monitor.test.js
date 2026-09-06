import test from "node:test";
import assert from "node:assert/strict";
import {
  markShadowAuditReviewerNotified,
  pendingShadowAuditReviewers,
  shadowAuditNotificationKind
} from "../src/shadow-monitor.js";

function audit(overrides = {}) {
  return {
    startedAt: "2026-08-07T00:00:00.000Z",
    elapsedDays: 3,
    maximumDays: 7,
    reviewed: 30,
    minimumAuditedMessages: 30,
    readyForManualPromotion: true,
    ...overrides
  };
}

test("ready shadow audit notifies each reviewer only once", () => {
  const first = pendingShadowAuditReviewers(audit(), {}, ["ou_a", "ou_a", "ou_b"]);
  assert.equal(first.kind, "ready");
  assert.deepEqual(first.reviewerIds, ["ou_a", "ou_b"]);

  const state = markShadowAuditReviewerNotified({}, first.key, "ou_a");
  const second = pendingShadowAuditReviewers(audit(), state, ["ou_a", "ou_b"]);
  assert.deepEqual(second.reviewerIds, ["ou_b"]);
});

test("maximum observation period warns once when reviewed sample is insufficient", () => {
  const result = pendingShadowAuditReviewers(audit({
    elapsedDays: 7,
    reviewed: 12,
    readyForManualPromotion: false
  }), {}, ["ou_owner"]);
  assert.equal(result.kind, "insufficient");
  assert.deepEqual(result.reviewerIds, ["ou_owner"]);
});

test("ordinary in-progress shadow audit remains silent", () => {
  assert.equal(shadowAuditNotificationKind(audit({
    elapsedDays: 2,
    reviewed: 5,
    readyForManualPromotion: false
  })), "");
});
