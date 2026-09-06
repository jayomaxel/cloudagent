import test from "node:test";
import assert from "node:assert/strict";
import { estimateModelCost, heartbeatIsStale, normalizeModelUsage, runtimeStatus } from "../src/health-status.js";

test("model usage and configurable cost include cached tokens", () => {
  const usage = normalizeModelUsage({ prompt_tokens: 1000, completion_tokens: 500, prompt_cache_hit_tokens: 200 });
  assert.deepEqual(usage, { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, cachedInputTokens: 200 });
  assert.equal(estimateModelCost(usage, { inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 }), 0.0057);
  assert.equal(estimateModelCost(usage, {}), null);
});

test("runtime is degraded while failures or retries exist", () => {
  assert.equal(runtimeStatus({ requestedStatus: "运行中" }), "运行中");
  assert.equal(runtimeStatus({ requestedStatus: "运行中", retryCount: 1 }), "降级运行");
  assert.equal(runtimeStatus({ requestedStatus: "已停止", retryCount: 1 }), "已停止");
});

test("heartbeat stale threshold is deterministic", () => {
  const now = Date.parse("2026-08-07T12:00:00Z");
  assert.equal(heartbeatIsStale("2026-08-07T11:51:00Z", now, 10), false);
  assert.equal(heartbeatIsStale("2026-08-07T11:50:00Z", now, 10), true);
});
