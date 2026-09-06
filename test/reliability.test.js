import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PendingBatchStore, failureTransition, isBatchAlreadyProcessed, isMessageAvailableForAnalysis, remainingRetryDelayMs, retryDelayMs, runReliableOperation, shouldReconcileBatchState } from "../src/reliability.js";

test("retryDelayMs follows the approved retry schedule and stops after five failures", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(retryDelayMs), [60_000, 300_000, 900_000, 3_600_000, null]);
});

test("remainingRetryDelayMs preserves future retries across process restarts", () => {
  const now = Date.parse("2026-08-06T10:00:00Z");

  assert.equal(remainingRetryDelayMs(now + 300_000, now), 300_000);
  assert.equal(remainingRetryDelayMs(now - 1, now), 0);
  assert.equal(remainingRetryDelayMs(null, now), 0);
});

test("failureTransition schedules retry before the fifth failure", () => {
  const now = Date.parse("2026-08-06T10:00:00Z");

  assert.deepEqual(failureTransition({ attempt: 2, now, error: new Error("model down") }), {
    status: "待重试",
    attempt: 2,
    nextRetryAt: now + 300_000,
    error: "model down"
  });
});

test("failureTransition marks the fifth failure as permanent", () => {
  const result = failureTransition({ attempt: 5, now: 1000, error: new Error("still down") });

  assert.equal(result.status, "永久失败");
  assert.equal(result.nextRetryAt, null);
});

test("runReliableOperation marks success only after the operation completes", async () => {
  const transitions = [];
  let attempts = 0;
  const result = await runReliableOperation({
    batchId: "batch_1",
    attempt: 1,
    operation: async () => {
      attempts += 1;
      return { written: 3 };
    },
    onTransition: async (transition) => transitions.push(transition.status)
  });

  assert.deepEqual(result, { written: 3 });
  assert.equal(attempts, 1);
  assert.deepEqual(transitions, ["处理中", "成功"]);
});

test("runReliableOperation records retry state when the operation fails", async () => {
  const transitions = [];

  await assert.rejects(() => runReliableOperation({
    batchId: "batch_1",
    attempt: 1,
    operation: async () => { throw new Error("base unavailable"); },
    onTransition: async (transition) => transitions.push(transition)
  }), /base unavailable/);

  assert.equal(transitions[0].status, "处理中");
  assert.equal(transitions[1].status, "待重试");
  assert.equal(transitions[1].attempt, 1);
});

test("PendingBatchStore persists only redacted messages and removes successful batches", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cloudagent-batch-"));
  const store = new PendingBatchStore(directory);

  store.save({
    batchId: "batch_1",
    attempt: 1,
    messages: [{ message_id: "om_1", content: "PASSWORD=hunter2" }]
  });

  const rawFile = fs.readFileSync(path.join(directory, "batch_1.json"), "utf8");
  assert.equal(rawFile.includes("hunter2"), false);
  assert.equal(store.load("batch_1").messages[0].content.includes("已隐藏敏感信息"), true);
  assert.equal(store.list().length, 1);

  store.remove("batch_1");
  assert.equal(store.list().length, 0);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("transition write failure never masks the original operation error", async () => {
  const original = new Error("original operation failure");

  await assert.rejects(
    runReliableOperation({
      batchId: "batch_original_error",
      attempt: 1,
      operation: async () => { throw original; },
      onTransition: async (state) => {
        if (state.status !== "处理中") throw new Error("state write failure");
      }
    }),
    (error) => error === original
  );
});

test("an overlapping batch is complete when every message succeeded elsewhere", () => {
  const batch = { messages: [{ message_id: "om_1" }, { message_id: "om_2" }] };

  assert.equal(isBatchAlreadyProcessed(batch, new Set(["om_1", "om_2"])), true);
  assert.equal(isBatchAlreadyProcessed(batch, new Set(["om_1"])), false);
  assert.equal(isBatchAlreadyProcessed({ messages: [] }, new Set()), false);
});

test("history backfill excludes processed and in-flight messages", () => {
  const processed = new Set(["om_done"]);
  const inFlight = new Set(["om_retrying"]);

  assert.equal(isMessageAvailableForAnalysis({ message_id: "om_new" }, processed, inFlight), true);
  assert.equal(isMessageAvailableForAnalysis({ message_id: "om_done" }, processed, inFlight), false);
  assert.equal(isMessageAvailableForAnalysis({ message_id: "om_retrying" }, processed, inFlight), false);
  assert.equal(isMessageAvailableForAnalysis({}, processed, inFlight), false);
});

test("stale Base state is reconciled only when all messages are already processed", () => {
  const processed = new Set(["om_1", "om_2"]);

  assert.equal(shouldReconcileBatchState("om_1,om_2", "待重试", processed), true);
  assert.equal(shouldReconcileBatchState("om_1,om_3", "待重试", processed), false);
  assert.equal(shouldReconcileBatchState("om_1,om_2", "成功", processed), false);
});
