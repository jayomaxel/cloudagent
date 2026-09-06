import test from "node:test";
import assert from "node:assert/strict";
import { buildBatchId, buildFactId, buildRouteId, contentFingerprint } from "../src/fact-id.js";

test("buildFactId is stable when source message order changes", () => {
  const base = {
    type: "action",
    projectId: "rec_project",
    subjectId: "ou_owner",
    content: "完成接口联调",
    sourceMessageIds: ["om_2", "om_1"]
  };

  const first = buildFactId(base);
  const second = buildFactId({ ...base, sourceMessageIds: ["om_1", "om_2", "om_1"] });

  assert.equal(first, second);
  assert.match(first, /^fact_[a-f0-9]{32}$/);
});

test("buildFactId distinguishes different facts from the same source", () => {
  const base = {
    type: "action",
    projectId: "rec_project",
    subjectId: "ou_owner",
    sourceMessageIds: ["om_1"]
  };

  assert.notEqual(
    buildFactId({ ...base, content: "完成接口联调" }),
    buildFactId({ ...base, content: "补充接口文档" })
  );
  assert.notEqual(
    buildFactId({ ...base, content: "完成接口联调" }),
    buildFactId({ ...base, subjectId: "ou_other", content: "完成接口联调" })
  );
});

test("buildRouteId distinguishes multiple project routes for one message", () => {
  assert.notEqual(
    buildRouteId({ messageId: "om_1", scopeType: "项目", projectId: "rec_aimi" }),
    buildRouteId({ messageId: "om_1", scopeType: "项目", projectId: "rec_cloud" })
  );
});

test("contentFingerprint normalizes spacing without erasing Chinese content", () => {
  assert.equal(contentFingerprint("  AIMI  已完成\n接口  "), contentFingerprint("AIMI 已完成 接口"));
});

test("buildBatchId is stable for the same conversation round", () => {
  const first = buildBatchId({ chatId: "oc_1", source: "实时消息", messageIds: ["om_2", "om_1"] });
  const second = buildBatchId({ chatId: "oc_1", source: "实时消息", messageIds: ["om_1", "om_2"] });

  assert.equal(first, second);
  assert.match(first, /^batch_[a-f0-9]{32}$/);
});
