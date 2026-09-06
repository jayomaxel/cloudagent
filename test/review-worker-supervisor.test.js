import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { ReviewWorkerSupervisor } from "../src/review-worker-supervisor.js";

class FakeChild extends EventEmitter {
  killed = false;
  kill() {
    this.killed = true;
  }
}

test("review worker is restarted without terminating the main Agent", () => {
  const children = [];
  const scheduled = [];
  const supervisor = new ReviewWorkerSupervisor({
    spawnWorker: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    schedule: (fn, delay) => {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    clearSchedule: () => {},
    logger: { info() {}, warn() {}, error() {} },
  });

  supervisor.start();
  assert.equal(children.length, 1);
  children[0].emit("exit", 1, null);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1_000);
  scheduled[0].fn();
  assert.equal(children.length, 2);
  supervisor.stop();
  assert.equal(children[1].killed, true);
});

