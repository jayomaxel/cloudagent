import test from "node:test";
import assert from "node:assert/strict";

import { clearRuntimeHandles, runOptionalStartupStep } from "../src/lifecycle.js";

test("startup failure cleanup removes every handle so the supervisor can restart", () => {
  let streamStopped = false;
  const runtime = {
    timers: [setInterval(() => {}, 60_000)],
    retryTimers: new Map([["batch_1", setTimeout(() => {}, 60_000)]]),
    notificationIdleTimers: new Map([["chat_1", setTimeout(() => {}, 60_000)]]),
    stream: { stop: () => { streamStopped = true; } }
  };

  clearRuntimeHandles(runtime);

  assert.equal(runtime.timers.length, 0);
  assert.equal(runtime.retryTimers.size, 0);
  assert.equal(runtime.notificationIdleTimers.size, 0);
  assert.equal(runtime.stream, null);
  assert.equal(streamStopped, true);
});

test("optional startup steps report failure without aborting startup", async () => {
  const failure = new Error("temporary Feishu EOF");
  let reported = null;

  const result = await runOptionalStartupStep(
    async () => { throw failure; },
    (error) => { reported = error; }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
  assert.equal(reported, failure);
});
