import test from "node:test";
import assert from "node:assert/strict";
import { ReviewAnalyzer } from "../src/review-analyzer.js";

function fakeClient(contents, seen) {
  return { chat: { completions: { create: async (request) => { seen.push(request); return { choices: [{ message: { content: JSON.stringify(contents.shift()) } }], usage: { total_tokens: 10 } }; } } } };
}

test("extraction and verification use separate prompts and redact secrets", async () => {
  const seen = [];
  const client = fakeClient([
    { summary: "完成", facts: [], contribution_claim: false },
    { verdict: "needs_supplement", evidence_grade: "C", risk_level: "低", rationale: "缺少证据" }
  ], seen);
  const analyzer = new ReviewAnalyzer({ model: "normal", reviewModel: "review", highRiskReviewModel: "risk", aiApiKey: "x", reliability: {} }, { client });
  const extraction = await analyzer.extractWeeklyCandidate({ text: "api_key=sk-12345678901234567890" });
  await analyzer.verifyWeeklyCandidate({ first_stage: extraction });
  assert.notEqual(seen[0].messages[0].content, seen[1].messages[0].content);
  assert.equal(seen[0].messages[1].content.includes("sk-123456"), false);
});

