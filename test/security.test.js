import test from "node:test";
import assert from "node:assert/strict";
import { redactText, sanitizeMessages } from "../src/security.js";

test("redactText removes credentials before model input", () => {
  const input = [
    "DEEPSEEK_API_KEY=sk-secret-1234567890",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.signature",
    "DATABASE_URL=postgres://admin:password@db.example.com/cloud",
    "验证码 654321"
  ].join("\n");

  const result = redactText(input);

  assert.equal(result.text.includes("sk-secret-1234567890"), false);
  assert.equal(result.text.includes("eyJhbGciOiJIUzI1NiJ9.secret.signature"), false);
  assert.equal(result.text.includes("postgres://admin:password"), false);
  assert.equal(result.text.includes("654321"), false);
  assert.deepEqual(result.detections.sort(), ["api_key", "authorization", "database_url", "verification_code"]);
});

test("redactText preserves ordinary dates, project numbers and percentages", () => {
  const input = "计划在 2026-08-06 完成 PRJ-202608001，当前完成度 90%。";

  assert.deepEqual(redactText(input), { text: input, detections: [] });
});

test("sanitizeMessages preserves metadata and redacts content", () => {
  const messages = [{
    message_id: "om_1",
    sender_id: "ou_1",
    create_time: "2026-08-06T10:00:00+08:00",
    reply_to: "om_0",
    content: "PASSWORD=hunter2"
  }];

  const result = sanitizeMessages(messages);

  assert.equal(result.messages[0].message_id, "om_1");
  assert.equal(result.messages[0].reply_to, "om_0");
  assert.equal(result.messages[0].content.includes("hunter2"), false);
  assert.deepEqual(result.detections, ["password"]);
});

