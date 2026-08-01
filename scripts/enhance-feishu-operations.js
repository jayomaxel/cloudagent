const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const cliScript = "C:\\Users\\jayomaxel\\AppData\\Roaming\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js";
const baseToken = "WGq3bSaOga59t5sXtRBch647nBh";
const baseUrl = "https://jcnm664gccao.feishu.cn/base/WGq3bSaOga59t5sXtRBch647nBh";
const owner = { id: "ou_10aa90c9cba9aaa057c8a36fd5c9e547", name: "焦雪晴" };
const resultPath = path.resolve("feishu-operations-result.json");

const tables = {
  members: { name: "成员档案", id: "tblqLkBgNnTnVV3b" },
  projects: { name: "项目库", id: "tbltMrqPXdOLOkPa" },
  contributions: { name: "社区贡献", id: "tblg8WpIwM15Y0Ri" },
  resources: { name: "公共资源使用记录", id: "tblIV1w2vtJps6kf" },
  activities: { name: "活动与培训", id: "tbl5roKV7dzXRKry" },
  decisions: { name: "问题与组织决策", id: "tblXjQbW1Cob8810" },
};

const fieldIds = {
  projectName: "fldYy5UzRF",
  projectOwner: "fldSWNVPOR",
  projectStatus: "fldObasMgB",
  projectRisk: "fldp0NyGYU",
  projectDeadline: "fldKRqsWMi",
  projectProgress: "fldMj8peFB",
  projectNext: "fldl16MLfG",
  resourceTitle: "fldd1Y4d6A",
  resourceUser: "fldAfMPL3P",
  resourceType: "fldEIH3xVC",
  resourceActual: "fldJlX1nQU",
  resourceStatus: "fldSMbUvHa",
  resourceException: "fldJClU899",
};

function parseFirstJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`No JSON found: ${text}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error(`Incomplete JSON: ${text}`);
}

function run(args) {
  const result = spawnSync(process.execPath, [cliScript, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    },
  });
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.status !== 0) throw new Error(`lark-cli failed (${args.slice(0, 2).join(" ")}):\n${combined}`);
  const envelope = parseFirstJson(combined);
  if (envelope.ok === false) throw new Error(JSON.stringify(envelope, null, 2));
  return envelope.data || envelope;
}

function findArray(value, keys) {
  if (!value || typeof value !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const nested of Object.values(value)) {
    const found = findArray(nested, keys);
    if (found.length) return found;
  }
  return [];
}

function findValue(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined && value[key] !== null) return value[key];
  }
  for (const nested of Object.values(value)) {
    const found = findValue(nested, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function listForms(tableId) {
  return findArray(run(["base", "+form-list", "--base-token", baseToken, "--table-id", tableId, "--as", "user", "--format", "json"]), ["forms", "items"]);
}

function ensureForm(table, name, description) {
  let form = listForms(table.id).find((item) => (item.name || item.title) === name);
  if (!form) {
    console.log(`Creating form: ${name}`);
    form = run(["base", "+form-create", "--base-token", baseToken, "--table-id", table.id, "--name", name, "--description", description, "--as", "user", "--format", "json"]);
  }
  const id = findValue(form, ["form_id", "id"]);
  if (!id) throw new Error(`Missing form id for ${name}: ${JSON.stringify(form)}`);
  return { id, name, tableId: table.id, tableName: table.name, url: `${baseUrl}?table=${table.id}&view=${id}` };
}

function updateFormQuestions(form, rules) {
  const listed = run(["base", "+form-questions-list", "--base-token", baseToken, "--table-id", form.tableId, "--form-id", form.id, "--as", "user", "--format", "json"]);
  const questions = findArray(listed, ["questions", "items"]);
  const updates = [];
  for (const question of questions) {
    const rule = rules[question.title];
    if (!rule) continue;
    const updated = {
      id: question.id,
      title: rule.title || question.title,
      description: rule.description !== undefined ? rule.description : (question.description || ""),
      required: rule.required !== undefined ? rule.required : Boolean(question.required),
      visible_rule: question.visible_rule || null,
    };
    if (question.type === "select" && question.option_display_mode !== undefined) updated.option_display_mode = question.option_display_mode;
    updates.push(updated);
  }
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    run(["base", "+form-questions-update", "--base-token", baseToken, "--table-id", form.tableId, "--form-id", form.id, "--questions", JSON.stringify(batch), "--as", "user", "--format", "json"]);
  }
}

function listDashboards() {
  return findArray(run(["base", "+dashboard-list", "--base-token", baseToken, "--as", "user", "--format", "json"]), ["dashboards", "items"]);
}

function ensureDashboard() {
  const name = "负责人管理仪表盘";
  let dashboard = listDashboards().find((item) => (item.name || item.title) === name);
  let createdNow = false;
  if (!dashboard) {
    console.log(`Creating dashboard: ${name}`);
    dashboard = run(["base", "+dashboard-create", "--base-token", baseToken, "--name", name, "--as", "user", "--format", "json"]);
    createdNow = true;
  }
  const id = findValue(dashboard, ["dashboard_id", "id"]);
  if (!id) throw new Error(`Missing dashboard id: ${JSON.stringify(dashboard)}`);
  return { id, name, createdNow, url: `${baseUrl}?table=${id}` };
}

function listDashboardBlocks(dashboardId) {
  return findArray(run(["base", "+dashboard-block-list", "--base-token", baseToken, "--dashboard-id", dashboardId, "--as", "user", "--format", "json"]), ["blocks", "items"]);
}

function ensureDashboardBlocks(dashboard) {
  const definitions = [
    ["负责人使用说明", "text", { text: "# 工作室负责人管理看板\n- 每周查看风险项目、资源异常和待处理事项\n- 每月结合贡献与成员成长阶段做一次社区复盘\n- 数据为空代表尚未登记，不代表没有风险" }],
    ["活跃成员数", "statistics", { table_name: "成员档案", count_all: true, filter: { conjunction: "and", conditions: [{ field_name: "成员状态", operator: "is", value: "活跃" }] } }],
    ["进行中项目数", "statistics", { table_name: "项目库", count_all: true, filter: { conjunction: "or", conditions: [{ field_name: "项目状态", operator: "is", value: "孵化中" }, { field_name: "项目状态", operator: "is", value: "开发中" }, { field_name: "项目状态", operator: "is", value: "待展示" }] } }],
    ["风险项目数", "statistics", { table_name: "项目库", count_all: true, filter: { conjunction: "or", conditions: [{ field_name: "风险状态", operator: "is", value: "需关注" }, { field_name: "风险状态", operator: "is", value: "受阻" }] } }],
    ["待处理资源异常", "statistics", { table_name: "公共资源使用记录", count_all: true, filter: { conjunction: "or", conditions: [{ field_name: "异常状态", operator: "is", value: "待核对" }, { field_name: "异常状态", operator: "is", value: "异常处理中" }] } }],
    ["待处理组织事项", "statistics", { table_name: "问题与组织决策", count_all: true, filter: { conjunction: "or", conditions: [{ field_name: "处理状态", operator: "is", value: "待讨论" }, { field_name: "处理状态", operator: "is", value: "处理中" }] } }],
    ["项目状态分布", "pie", { table_name: "项目库", count_all: true, group_by: [{ field_name: "项目状态", mode: "integrated" }] }],
    ["成员成长阶段", "pie", { table_name: "成员档案", count_all: true, group_by: [{ field_name: "成长阶段", mode: "integrated" }] }],
    ["社区贡献类型", "column", { table_name: "社区贡献", count_all: true, group_by: [{ field_name: "贡献类型", mode: "integrated", sort: { type: "value", order: "desc" } }] }],
    ["活动状态分布", "column", { table_name: "活动与培训", count_all: true, group_by: [{ field_name: "活动状态", mode: "integrated" }] }],
  ];
  const existing = listDashboardBlocks(dashboard.id);
  const names = new Set(existing.map((item) => item.name || item.title));
  for (const [name, type, config] of definitions) {
    if (names.has(name)) continue;
    console.log(`Creating dashboard block: ${name}`);
    run(["base", "+dashboard-block-create", "--base-token", baseToken, "--dashboard-id", dashboard.id, "--name", name, "--type", type, "--data-config", JSON.stringify(config), "--as", "user", "--format", "json"]);
    names.add(name);
  }
  if (dashboard.createdNow) {
    run(["base", "+dashboard-arrange", "--base-token", baseToken, "--dashboard-id", dashboard.id, "--as", "user", "--format", "json"]);
  }
}

function listWorkflows() {
  return findArray(run(["base", "+workflow-list", "--base-token", baseToken, "--as", "user", "--format", "json"]), ["workflows", "items"]);
}

function text(value) { return { value_type: "text", value }; }
function ref(value) { return { value_type: "ref", value }; }
function option(name) { return { value_type: "option", value: { name } }; }
function user(value) { return { value_type: "user", value }; }

function workflowDefinitions() {
  return [
    {
      title: "项目风险状态提醒",
      steps: [
        { id: "trigger_project_risk", type: "SetRecordTrigger", title: "项目风险变为需关注或受阻", next: "notify_project_risk", data: { table_name: "项目库", record_watch_conjunction: "and", field_watch_info: [{ field_name: "风险状态", operator: "containsAny", value: [option("需关注"), option("受阻")] }], trigger_control_list: [], condition_list: null } },
        { id: "notify_project_risk", type: "LarkMessageAction", title: "通知项目负责人和工作室负责人", next: null, data: { receiver: [ref(`$.trigger_project_risk.${fieldIds.projectOwner}`), user(owner)], send_to_everyone: false, title: [text("项目风险提醒")], content: [text("项目“"), ref(`$.trigger_project_risk.${fieldIds.projectName}`), text("”的风险状态已变为："), ref(`$.trigger_project_risk.${fieldIds.projectRisk}`), text("。\n本周进展："), ref(`$.trigger_project_risk.${fieldIds.projectProgress}`), text("\n下一步："), ref(`$.trigger_project_risk.${fieldIds.projectNext}`)], btn_list: [{ text: "查看项目", btn_action: "openLink", link: [ref("$.trigger_project_risk.recordLink")] }] } },
      ],
    },
    {
      title: "公共资源异常提醒",
      steps: [
        { id: "trigger_resource_risk", type: "SetRecordTrigger", title: "资源状态变为待核对或处理中", next: "notify_resource_risk", data: { table_name: "公共资源使用记录", record_watch_conjunction: "and", field_watch_info: [{ field_name: "异常状态", operator: "containsAny", value: [option("待核对"), option("异常处理中")] }], trigger_control_list: [], condition_list: null } },
        { id: "notify_resource_risk", type: "LarkMessageAction", title: "通知使用人与工作室负责人", next: null, data: { receiver: [ref(`$.trigger_resource_risk.${fieldIds.resourceUser}`), user(owner)], send_to_everyone: false, title: [text("公共资源异常提醒")], content: [text("资源事项“"), ref(`$.trigger_resource_risk.${fieldIds.resourceTitle}`), text("”需要处理。\n资源类型："), ref(`$.trigger_resource_risk.${fieldIds.resourceType}`), text("\n实际消耗："), ref(`$.trigger_resource_risk.${fieldIds.resourceActual}`), text(" USD\n异常说明："), ref(`$.trigger_resource_risk.${fieldIds.resourceException}`)], btn_list: [{ text: "查看记录", btn_action: "openLink", link: [ref("$.trigger_resource_risk.recordLink")] }] } },
      ],
    },
    {
      title: "项目交付前两天提醒",
      steps: [
        { id: "trigger_project_deadline", type: "ReminderTrigger", title: "交付日期前两天上午九点", next: "notify_project_deadline", data: { table_name: "项目库", field_name: "计划交付", unit: "DAY", offset: 2, hour: 9, minute: 0, condition_list: [{ conjunction: "and", conditions: [{ field_name: "项目状态", operator: "containsAny", value: [option("孵化中"), option("开发中"), option("待展示")] }] }] } },
        { id: "notify_project_deadline", type: "LarkMessageAction", title: "提醒项目负责人和工作室负责人", next: null, data: { receiver: [ref(`$.trigger_project_deadline.${fieldIds.projectOwner}`), user(owner)], send_to_everyone: false, title: [text("项目交付提醒")], content: [text("项目“"), ref(`$.trigger_project_deadline.${fieldIds.projectName}`), text("”将在两天后到达计划交付日期。\n当前状态："), ref(`$.trigger_project_deadline.${fieldIds.projectStatus}`), text("\n下一步："), ref(`$.trigger_project_deadline.${fieldIds.projectNext}`)], btn_list: [{ text: "查看项目", btn_action: "openLink", link: [ref("$.trigger_project_deadline.recordLink")] }] } },
      ],
    },
  ];
}

function ensureWorkflows() {
  const definitions = workflowDefinitions();
  let existing = listWorkflows();
  const results = [];
  for (const definition of definitions) {
    let workflow = existing.find((item) => (item.title || item.name) === definition.title);
    if (!workflow) {
      console.log(`Creating workflow: ${definition.title}`);
      workflow = run(["base", "+workflow-create", "--base-token", baseToken, "--json", JSON.stringify({ client_token: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, title: definition.title, steps: definition.steps }), "--as", "user", "--format", "json"]);
      existing = listWorkflows();
      workflow = existing.find((item) => (item.title || item.name) === definition.title) || workflow;
    }
    const id = findValue(workflow, ["workflow_id", "id"]);
    if (!id) throw new Error(`Missing workflow id for ${definition.title}: ${JSON.stringify(workflow)}`);
    const status = String(findValue(workflow, ["status"]) || "").toLowerCase();
    if (status !== "enabled") {
      console.log(`Enabling workflow: ${definition.title}`);
      run(["base", "+workflow-enable", "--base-token", baseToken, "--workflow-id", id, "--as", "user", "--format", "json"]);
    }
    results.push({ id, title: definition.title, enabled: true, url: `${baseUrl}?table=${id}` });
  }
  return results;
}

function main() {
  const projectForm = ensureForm(tables.projects, "项目立项申请", "成员自主发起项目的入口。填写前请先阅读知识库中的项目立项 SOP。");
  updateFormQuestions(projectForm, {
    "项目名称": { required: true, description: "用一句清晰、可识别的名称描述项目。" },
    "项目负责人": { required: true, description: "负责人负责目标、节奏和风险沟通，不等于承担全部代码。" },
    "项目成员": { required: false, description: "可先留空，确认合作后再补充。" },
    "项目类型": { required: true },
    "问题与价值假设": { required: true, description: "说明要解决什么问题、面向谁，以及为什么值得做。" },
    "计划交付": { required: true, description: "建议设置两到四周内可验证的日期。" },
    "下一步行动": { required: true, description: "填写立项后最先执行的一个具体动作。" },
    "项目状态": { title: "项目状态（首次提交保持“想法池”）", required: false, description: "由负责人在立项讨论后维护。" },
    "风险状态": { title: "风险状态（首次提交保持“正常”）", required: false, description: "由项目负责人持续维护。" },
    "本周进展": { title: "已有进展（没有可留空）", required: false },
    "立项日期": { required: false, description: "正式立项后由负责人补充。" },
  });

  const resourceForm = ensureForm(tables.resources, "公共资源使用登记", "使用 Codex、API、服务器、充值卡或其他公共资源时，在这里留下记录。");
  updateFormQuestions(resourceForm, {
    "使用事项": { required: true, description: "简要说明本次使用，例如“项目 Demo 调试”。" },
    "使用时间": { required: true },
    "使用人": { required: true },
    "资源类型": { required: true },
    "所属项目": { required: false },
    "用途说明": { required: true, description: "说明要完成什么，以及为什么需要该公共资源。" },
    "预计消耗 USD": { required: false, description: "无法精确估计时可填写大致数值。" },
    "实际消耗 USD": { required: false, description: "使用完成后补充；首次登记可留空。" },
    "已提前沟通": { title: "是否已按规则提前沟通", required: false, description: "涉及付费余额、充值卡、长时间任务或明显影响他人时必须提前沟通。" },
    "异常状态": { title: "异常状态（正常使用保持“正常”）", required: false, description: "发现超额、误用或安全问题时再修改。" },
    "异常说明": { required: false, description: "只有发生异常时填写。" },
    "后续处置": { title: "负责人后续处置（提交者可留空）", required: false },
  });

  const contributionForm = ensureForm(tables.contributions, "社区贡献提交", "代码之外的帮助、文档、分享、维护、组织和主动担责都属于社区贡献。");
  updateFormQuestions(contributionForm, {
    "贡献标题": { required: true },
    "贡献日期": { required: true },
    "贡献成员": { required: true },
    "贡献类型": { required: true },
    "贡献说明": { required: true, description: "说明做了什么，以及对成员、项目或社区产生了什么帮助。" },
    "关联项目": { required: false },
    "证明链接": { required: false, description: "可填写文档、代码、Demo、会议记录等链接。" },
    "影响范围": { required: true },
    "已确认": { title: "管理员确认（提交者请勿勾选）", required: false, description: "由核心成员或负责人核对后勾选。" },
  });

  const dashboard = ensureDashboard();
  ensureDashboardBlocks(dashboard);
  const workflows = ensureWorkflows();

  const result = {
    status: "complete",
    forms: [projectForm, resourceForm, contributionForm],
    dashboard,
    workflows,
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main();
