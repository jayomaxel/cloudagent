import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("initial Base state writes are inside the retryable batch boundary", () => {
  const source = fs.readFileSync(new URL("../src/agent.js", import.meta.url), "utf8");
  const start = source.indexOf("async flushBatch(batch");
  const end = source.indexOf("async reconcileProcessedPendingBatches", start);
  const flushBatchSource = source.slice(start, end);
  const pendingSave = flushBatchSource.indexOf("this.pendingBatchStore.save(batch);");
  const retryBoundary = flushBatchSource.indexOf("try {", pendingSave);
  const messageIndexWrite = flushBatchSource.indexOf("this.writeMessageIndexes", pendingSave);
  const batchStateWrite = flushBatchSource.indexOf("this.writeBatchState", pendingSave);

  assert.ok(pendingSave >= 0);
  assert.ok(retryBoundary > pendingSave);
  assert.ok(messageIndexWrite > retryBoundary);
  assert.ok(batchStateWrite > retryBoundary);
});
