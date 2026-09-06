import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisPayload, buildNotificationPayload } from "../src/analyzer.js";

test("buildAnalysisPayload redacts secrets even when caller passes raw messages", () => {
  const payload = buildAnalysisPayload({
    projectName: "AIMI智能体",
    chatId: "oc_1",
    identityContext: {},
    messages: [{ message_id: "om_1", sender_id: "ou_1", content: "API_KEY=sk-secret-123456" }]
  });

  assert.equal(JSON.stringify(payload).includes("sk-secret-123456"), false);
  assert.equal(payload.messages[0].message_id, "om_1");
});

test("buildNotificationPayload uses the same redaction boundary", () => {
  const payload = buildNotificationPayload({
    projectName: "AIMI智能体",
    chatName: "AIMI智能体设计",
    messages: [{ message_id: "om_1", sender_id: "ou_1", content: "验证码 123456" }]
  });

  assert.equal(JSON.stringify(payload).includes("123456"), false);
});

