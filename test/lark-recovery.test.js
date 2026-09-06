import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  LarkClient,
  eventRestartDelayMs,
  isRetryableTransportFailure,
  isSafeToRetryCliCommand
} from "../src/lark.js";

function clientConfig(overrides = {}) {
  return {
    root: process.cwd(),
    larkCliEntry: "fake-lark-cli.js",
    baseToken: "base-token",
    reliability: {
      transportRetryDelaysMs: [0, 0],
      eventRestartDelaysMs: [0],
      ...overrides
    }
  };
}

function cliResult({ status = 0, stdout = "", stderr = "" } = {}) {
  return { status, stdout, stderr, error: null };
}

function fakeEventChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = { end: () => { child.killed = true; } };
  child.killed = false;
  return child;
}

test("安全读取遇到两次 EOF 后返回第三次成功结果", () => {
  const responses = [
    cliResult({ status: 1, stderr: '{"ok":false,"error":{"type":"network","subtype":"transport","message":"EOF"}}' }),
    cliResult({ status: 1, stderr: '{"ok":false,"error":{"type":"network","subtype":"transport","message":"EOF"}}' }),
    cliResult({ stdout: '{"ok":true,"data":{"value":"recovered"}}' })
  ];
  let calls = 0;
  const client = new LarkClient(clientConfig(), {
    spawnSync: () => {
      calls += 1;
      return responses.shift();
    },
    sleep: () => {}
  });

  const output = client.runJson(["base", "+record-list", "--table-id", "table"]);

  assert.equal(output.data.value, "recovered");
  assert.equal(calls, 3);
});

test("非幂等批量创建遇到 EOF 不在底层重复提交", () => {
  let calls = 0;
  const client = new LarkClient(clientConfig(), {
    spawnSync: () => {
      calls += 1;
      return cliResult({ status: 1, stderr: "EOF" });
    },
    sleep: () => {}
  });

  assert.throws(
    () => client.runJson(["base", "+record-batch-create", "--table-id", "table"]),
    /EOF/
  );
  assert.equal(calls, 1);
});

test("已经就绪的事件消费者退出后自动拉起新消费者", async () => {
  const children = [];
  const client = new LarkClient(clientConfig(), {
    spawn: () => {
      const child = fakeEventChild();
      children.push(child);
      return child;
    }
  });

  const handlePromise = client.startEventStream("im.chat.member.user.added_v1", () => {});
  children[0].stderr.write("[event] ready event_key=im.chat.member.user.added_v1\n");
  const handle = await handlePromise;
  children[0].emit("exit", 4);
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(children.length, 2);
  children[1].stderr.write("[event] ready event_key=im.chat.member.user.added_v1\n");
  handle.stop();
});

test("重试分类只允许读取、幂等更新和带幂等键的发送", () => {
  assert.equal(isRetryableTransportFailure('{"error":{"type":"network","subtype":"transport"}}'), true);
  assert.equal(isSafeToRetryCliCommand(["im", "chats", "get"]), true);
  assert.equal(isSafeToRetryCliCommand(["base", "+record-batch-update"]), true);
  assert.equal(isSafeToRetryCliCommand(["base", "+record-batch-create"]), false);
  assert.equal(isSafeToRetryCliCommand(["im", "+messages-send"]), false);
  assert.equal(isSafeToRetryCliCommand(["im", "+messages-send", "--idempotency-key", "notice"]), true);
  assert.equal(eventRestartDelayMs(9, [1000, 5000]), 5000);
});
