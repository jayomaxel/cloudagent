import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = JSON.parse(readFileSync(
  new URL("../.data/workflow-json/cloudagent-heartbeat-timeout.json", import.meta.url),
  "utf8"
));

test("heartbeat timeout compares an exact numeric heartbeat version", () => {
  const findStep = workflow.steps.find((step) => step.id === "step_find_stale");
  const conditions = findStep.data.filter_info.conditions;
  const versionCondition = conditions.find((condition) => condition.field_name === "运行时长秒");

  assert.deepEqual(versionCondition, {
    field_name: "运行时长秒",
    operator: "is",
    value: [{ value_type: "ref", value: "$.step_heartbeat.fldQfBLaQg" }]
  });
  assert.equal(conditions.some((condition) => condition.field_name === "最近心跳"), false);
});

test("heartbeat timeout sends only one private owner notification", () => {
  const sendStep = workflow.steps.find((step) => step.id === "step_send_timeout");

  assert.equal(sendStep.data.send_to_everyone, false);
  assert.deepEqual(sendStep.data.receiver, [{
    value_type: "user",
    value: {
      id: "ou_10aa90c9cba9aaa057c8a36fd5c9e547",
      name: "焦雪晴"
    }
  }]);
});
