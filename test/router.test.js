import test from "node:test";
import assert from "node:assert/strict";
import {
  ProjectRouter,
  mergeAiRouteSuggestions,
  normalizeAlias,
  selectReviewerOpenIds
} from "../src/router.js";

const projects = [
  { recordId: "rec_cloud", name: "云门工作室管理 Agent", aliases: ["飞书云agent", "CloudAgent"] },
  { recordId: "rec_aimi", name: "AIMI智能体", aliases: ["AIMI", "AIMI智能体设计"] },
  { recordId: "rec_wuzhou", name: "五洲项目", aliases: ["五洲", "五州"] },
  { recordId: "rec_ops", name: "工作室运营 / 多项目混合", aliases: ["开发组", "团队管理"] }
];

function message(id, content, replyTo = "") {
  return { message_id: id, sender_id: "ou_student", content, reply_to: replyTo };
}

test("normalizeAlias matches case, whitespace and punctuation consistently", () => {
  assert.equal(normalizeAlias(" Cloud-Agent "), normalizeAlias("cloud agent"));
});

test("project-bound chat routes directly to its configured project", () => {
  const router = new ProjectRouter({ projects, operationsProjectName: "工作室运营 / 多项目混合" });
  const routes = router.routeRound({
    mapping: { chatType: "项目专属", projectRecordId: "rec_aimi", projectName: "AIMI智能体" },
    messages: [message("om_1", "完成了接口联调")]
  });

  assert.equal(routes.length, 1);
  assert.equal(routes[0].projectRecordId, "rec_aimi");
  assert.equal(routes[0].basis, "群绑定");
  assert.equal(routes[0].reviewStatus, "自动确认");
});

test("mixed chat routes confirmed aliases and explicit project labels automatically", () => {
  const router = new ProjectRouter({ projects, operationsProjectName: "工作室运营 / 多项目混合" });
  const routes = router.routeRound({
    mapping: { chatType: "混合", projectName: "工作室运营 / 多项目混合" },
    messages: [message("om_1", "【项目】AIMI 本周完成知识库字段调整")]
  });

  assert.equal(routes.length, 1);
  assert.equal(routes[0].projectRecordId, "rec_aimi");
  assert.equal(routes[0].reviewStatus, "自动确认");
});

test("mixed chat creates multiple routes when one message names two projects", () => {
  const router = new ProjectRouter({ projects, operationsProjectName: "工作室运营 / 多项目混合" });
  const routes = router.routeRound({
    mapping: { chatType: "混合" },
    messages: [message("om_1", "协调 AIMI 和五洲项目共用测试服务器")]
  });

  assert.deepEqual(routes.map((item) => item.projectRecordId).sort(), ["rec_aimi", "rec_wuzhou"]);
});

test("explicit operations label routes to the operations anchor", () => {
  const router = new ProjectRouter({ projects, operationsProjectName: "工作室运营 / 多项目混合" });
  const routes = router.routeRound({
    mapping: { chatType: "混合" },
    messages: [message("om_1", "【工作室运营】更新新人入门 SOP")]
  });

  assert.equal(routes[0].scopeType, "工作室运营");
  assert.equal(routes[0].projectRecordId, "rec_ops");
});

test("unknown mixed-chat message remains pending instead of entering a project", () => {
  const router = new ProjectRouter({ projects, operationsProjectName: "工作室运营 / 多项目混合" });
  const routes = router.routeRound({
    mapping: { chatType: "混合" },
    messages: [message("om_1", "这个问题我晚点继续看")]
  });

  assert.equal(routes[0].scopeType, "无法确认");
  assert.equal(routes[0].reviewStatus, "待确认");
  assert.equal(routes[0].projectRecordId, "");
});

test("AI route suggestions always require human confirmation", () => {
  const merged = mergeAiRouteSuggestions([], [{
    messageId: "om_1",
    scopeType: "项目",
    projectRecordId: "rec_aimi",
    projectName: "AIMI智能体",
    confidence: 0.99,
    basis: "AI判断"
  }]);

  assert.equal(merged[0].reviewStatus, "待确认");
  assert.equal(merged[0].confidence, 0.99);
});

test("selectReviewerOpenIds chooses active members whose growth stage is owner", () => {
  const reviewers = selectReviewerOpenIds([
    { openId: "ou_owner_1", stage: "负责人", status: "活跃" },
    { openId: "ou_owner_2", stage: "负责人", status: "低活跃" },
    { openId: "ou_paused", stage: "负责人", status: "暂休" },
    { openId: "ou_member", stage: "正式成员", status: "活跃" }
  ]);

  assert.deepEqual(reviewers, ["ou_owner_1", "ou_owner_2"]);
});

