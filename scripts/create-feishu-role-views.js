const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CLI = "C:\\Users\\jayomaxel\\AppData\\Roaming\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js";
const BASE_TOKEN = "WGq3bSaOga59t5sXtRBch647nBh";
const OWNER_OPEN_ID = "ou_10aa90c9cba9aaa057c8a36fd5c9e547";

const tables = {
  members: "tblqLkBgNnTnVV3b",
  projects: "tbltMrqPXdOLOkPa",
  contributions: "tblg8WpIwM15Y0Ri",
  resources: "tblIV1w2vtJps6kf",
};

function parseOutput(stdout) {
  const text = stdout.trim();
  const start = text.indexOf("{");
  if (start < 0) return { raw: text };
  return JSON.parse(text.slice(start));
}

function callCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args, "--format", "json"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Unknown lark-cli error").trim());
  }

  const output = parseOutput(result.stdout);
  if (output.ok === false) {
    throw new Error(JSON.stringify(output.error || output));
  }
  return output;
}

function baseArgs(command, tableId) {
  return ["base", command, "--base-token", BASE_TOKEN, "--table-id", tableId];
}

function listFields(tableId) {
  return callCli(baseArgs("+field-list", tableId)).data.fields || [];
}

function ensureField(tableId, definition) {
  const existing = listFields(tableId).find((field) => field.name === definition.name);
  if (existing) return { name: definition.name, id: existing.id, status: "already_exists" };

  const output = callCli([
    ...baseArgs("+field-create", tableId),
    "--json",
    JSON.stringify(definition),
    "--i-have-read-guide",
  ]);
  return { name: definition.name, status: "created", output: output.data || output };
}

function listViews(tableId) {
  return callCli(baseArgs("+view-list", tableId)).data.views || [];
}

function ensureView(tableId, name) {
  const existing = listViews(tableId).find((view) => view.name === name);
  if (existing) return { name, id: existing.id, status: "already_exists" };

  const output = callCli([
    ...baseArgs("+view-create", tableId),
    "--json",
    JSON.stringify({ name, type: "grid" }),
  ]);
  const data = output.data || {};
  return {
    name,
    id: data.id || data.view_id || (data.view && data.view.id),
    status: "created",
  };
}

function setFilter(tableId, viewName, filter) {
  callCli([
    ...baseArgs("+view-set-filter", tableId),
    "--view-id",
    viewName,
    "--json",
    JSON.stringify(filter),
  ]);
  return { name: viewName, status: "filter_configured" };
}

const result = {
  baseToken: BASE_TOKEN,
  baseUrl: `https://jcnm664gccao.feishu.cn/base/${BASE_TOKEN}`,
  generatedAt: new Date().toISOString(),
  fields: [],
  views: [],
};

result.fields.push(
  ensureField(tables.projects, {
    name: "交付预警",
    type: "formula",
    expression:
      'IF(OR([项目状态] = "已完成", [项目状态] = "已归档"), "已关闭", IF(ISBLANK([计划交付]), "未排期", IF(DAYS([计划交付], TODAY()) < 0, "已逾期", IF(DAYS([计划交付], TODAY()) <= 7, "7天内交付", "正常"))))',
  }),
  ensureField(tables.projects, {
    name: "更新健康度",
    type: "formula",
    expression:
      'IF(OR([项目状态] = "已完成", [项目状态] = "已归档"), "已关闭", IF([项目状态] = "暂停", "已暂停", IF(DAYS(TODAY(), [最近更新]) >= 7, "长期未更新", IF(DAYS(TODAY(), [最近更新]) >= 3, "需更新", "正常"))))',
  }),
  ensureField(tables.members, {
    name: "新人跟进阶段",
    type: "formula",
    expression:
      'IF([成员状态] = "已退出", "已退出", IF([成长阶段] != "观察成员", "已转正式", IF(ISBLANK([加入日期]), "待补加入日期", IF(DAYS(TODAY(), [加入日期]) < 0, "日期异常", IF(DAYS(TODAY(), [加入日期]) <= 7, "7天内", IF(DAYS(TODAY(), [加入日期]) <= 30, "8-30天", "超过30天待评估"))))))',
  })
);

const viewDefinitions = [
  {
    tableId: tables.projects,
    name: "我的项目｜焦雪晴",
    filter: {
      logic: "or",
      conditions: [
        ["项目负责人", "intersects", [{ id: OWNER_OPEN_ID }]],
        ["项目成员", "intersects", [{ id: OWNER_OPEN_ID }]],
      ],
    },
  },
  {
    tableId: tables.projects,
    name: "本周待交付",
    filter: {
      logic: "or",
      conditions: [
        ["交付预警", "intersects", "7天内交付"],
        ["交付预警", "intersects", "已逾期"],
      ],
    },
  },
  {
    tableId: tables.projects,
    name: "风险项目",
    filter: {
      logic: "and",
      conditions: [
        ["风险状态", "intersects", ["需关注", "受阻"]],
        ["项目状态", "disjoint", ["已完成", "已归档"]],
      ],
    },
  },
  {
    tableId: tables.projects,
    name: "暂停与长期未更新",
    filter: {
      logic: "or",
      conditions: [
        ["项目状态", "intersects", ["暂停"]],
        ["更新健康度", "intersects", "长期未更新"],
      ],
    },
  },
  {
    tableId: tables.contributions,
    name: "待确认贡献",
    filter: { logic: "and", conditions: [["已确认", "==", false]] },
  },
  {
    tableId: tables.resources,
    name: "待处理资源异常",
    filter: {
      logic: "and",
      conditions: [["异常状态", "intersects", ["待核对", "异常处理中"]]],
    },
  },
  {
    tableId: tables.members,
    name: "新人30天跟进",
    filter: {
      logic: "or",
      conditions: [
        ["新人跟进阶段", "intersects", "7天内"],
        ["新人跟进阶段", "intersects", "8-30天"],
        ["新人跟进阶段", "intersects", "超过30天待评估"],
        ["新人跟进阶段", "intersects", "待补加入日期"],
      ],
    },
  },
];

for (const definition of viewDefinitions) {
  const view = ensureView(definition.tableId, definition.name);
  setFilter(definition.tableId, definition.name, definition.filter);
  result.views.push({ ...view, filterStatus: "configured" });
}

const resultPath = path.resolve(__dirname, "..", "feishu-role-views-result.json");
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(result, null, 2));
