import test from "node:test";
import assert from "node:assert/strict";

import { shouldPrunePendingBatch } from "../src/reliability.js";

test("retention only prunes old, permanently exhausted batches", () => {
  const now = Date.parse("2026-08-10T00:00:00Z");
  const old = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(shouldPrunePendingBatch({ savedAt: old, retryAttempt: 5 }, { now, retentionDays: 30, maxAttempts: 5 }), true);
  assert.equal(shouldPrunePendingBatch({ savedAt: recent, retryAttempt: 5 }, { now, retentionDays: 30, maxAttempts: 5 }), false);
  assert.equal(shouldPrunePendingBatch({ savedAt: old, retryAttempt: 2 }, { now, retentionDays: 30, maxAttempts: 5 }), false);
});

