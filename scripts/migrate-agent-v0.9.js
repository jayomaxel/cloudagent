import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/config.js";
import { larkCliInvocation } from "../src/lark-cli-process.js";

const config = loadConfig();
const cli = process.env.LARK_CLI_ENTRY || config.larkCliEntry;
const tableName = "Agent 消息项目归属";
const primaryFieldName = "消息概览";
const internalRouteFieldName = "内部路由ID";

const visibleFields = [
  "消息概览",
  "消息内容预览",
  "发送人姓名",
  "群聊名称",
  "消息时间",
  "Agent建议归属",
  "判断说明",
  "置信度",
  "审核状态",
  "审核提示",
  "关联项目",
  "消息链接",
];

function run(args, { safeRetry = true } = {}) {
  const attempts = safeRetry ? 4 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const invocation = larkCliInvocation(cli, [...args, "--format", "json"]);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: config.root,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
      },
    });
    try {
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || `lark-cli exited ${result.status}`);
      const start = result.stdout.indexOf("{");
      const payload = JSON.parse(result.stdout.slice(start));
      if (payload.ok === false) throw new Error(payload.error?.message || JSON.stringify(payload.error));
      return payload;
    } catch (error) {
      lastError = error;
      if (!/(EOF|ECONNRESET|ETIMEDOUT|network|socket|连接|网络)/i.test(String(error.message))) break;
    }
  }
  throw lastError;
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function loadTable() {
  const output = run(["base", "+table-list", "--base-token", config.baseToken, "--as", "user", "--limit", "100"]);
  const table = (output.data?.tables || []).find((item) => item.name === tableName);
  if (!table) throw new Error(`找不到数据表：${tableName}`);
  return table;
}

function loadFields(tableId) {
  const output = run(["base", "+table-get", "--base-token", config.baseToken, "--table-id", tableId, "--as", "user"]);
  return {
    fields: output.data?.fields || [],
    primaryFieldId: output.data?.table?.primary_field,
  };
}

function ensureInternalRouteField(tableId, fields) {
  const existing = fields.find((field) => field.name === internalRouteFieldName);
  if (existing) return existing;
  const output = run([
    "base", "+field-create", "--base-token", config.baseToken, "--table-id", tableId, "--as", "user",
    "--json", JSON.stringify({
      name: internalRouteFieldName,
      type: "text",
      description: "Agent 内部去重与追踪标识，不在负责人视图中展示",
    }),
  ], { safeRetry: false });
  return output.data?.fields?.[0] || output.data?.field || { name: internalRouteFieldName };
}

function readRows(tableId, currentPrimaryName) {
  const requested = [...new Set([
    currentPrimaryName,
    internalRouteFieldName,
    "消息内容预览",
    "发送人姓名",
    "群聊名称",
    "消息时间",
  ])];
  const rows = [];
  let offset = 0;
  while (true) {
    const args = [
      "base", "+record-list", "--base-token", config.baseToken, "--table-id", tableId,
      "--as", "user", "--limit", "200", "--offset", String(offset),
    ];
    requested.forEach((field) => args.push("--field-id", field));
    const output = run(args);
    const data = output.data || {};
    const returnedFields = data.fields || requested;
    (data.data || []).forEach((values, index) => {
      rows.push({
        recordId: data.record_id_list[index],
        fields: Object.fromEntries(returnedFields.map((field, fieldIndex) => [field, values[fieldIndex]])),
      });
    });
    if (!data.has_more || !(data.data || []).length) break;
    offset += data.data.length;
  }
  return rows;
}

function updateRows(tableId, updates) {
  const entries = Object.entries(updates);
  for (const batch of chunks(entries, 200)) {
    run([
      "base", "+record-batch-update", "--base-token", config.baseToken, "--table-id", tableId, "--as", "user",
      "--json", JSON.stringify({ update_records: Object.fromEntries(batch) }),
    ]);
  }
}

function compact(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function buildOverview(fields, currentPrimaryName) {
  const sender = compact(fields["发送人姓名"] || "未识别成员", 24);
  const chat = compact(fields["群聊名称"] || "未知群聊", 32);
  const preview = compact(fields["消息内容预览"] || "消息内容暂不可读", 100);
  const generated = `${sender}｜${chat}｜${preview}`;
  if (generated.replace(/[｜\s]/g, "")) return compact(generated, 180);
  return currentPrimaryName === primaryFieldName ? compact(fields[primaryFieldName], 180) : "消息内容暂不可读";
}

function renamePrimaryField(tableId, field) {
  if (field.name === primaryFieldName) return false;
  run([
    "base", "+field-update", "--base-token", config.baseToken, "--table-id", tableId,
    "--field-id", field.id, "--as", "user", "--json", JSON.stringify({
      name: primaryFieldName,
      type: "text",
      style: field.style || { type: "plain" },
      default_value: field.default_value ?? null,
      description: "负责人可直接识别的消息标题：发送人｜来源群｜消息摘要",
    }),
    "--yes",
  ], { safeRetry: false });
  return true;
}

function updateViews(tableId) {
  const output = run(["base", "+view-list", "--base-token", config.baseToken, "--table-id", tableId, "--as", "user", "--limit", "100"]);
  const updated = [];
  for (const view of output.data?.views || []) {
    if (!["Grid View", "负责人审核视图", "全部消息（可读）"].includes(view.name)) continue;
    run([
      "base", "+view-set-visible-fields", "--base-token", config.baseToken, "--table-id", tableId,
      "--view-id", view.id, "--as", "user", "--json", JSON.stringify({ visible_fields: visibleFields }),
    ], { safeRetry: false });
    updated.push(view.name);
  }
  return updated;
}

function main() {
  const table = loadTable();
  const structure = loadFields(table.id);
  const primaryField = structure.fields.find((field) => field.id === structure.primaryFieldId);
  if (!primaryField) throw new Error("无法识别当前主字段");
  ensureInternalRouteField(table.id, structure.fields);

  const rows = readRows(table.id, primaryField.name);
  const routeUpdates = {};
  for (const row of rows) {
    const existingInternal = String(row.fields[internalRouteFieldName] || "").trim();
    const oldPrimary = String(row.fields[primaryField.name] || "").trim();
    if (!existingInternal && oldPrimary) routeUpdates[row.recordId] = { [internalRouteFieldName]: oldPrimary };
  }
  updateRows(table.id, routeUpdates);

  const renamed = renamePrimaryField(table.id, primaryField);
  const overviewUpdates = Object.fromEntries(rows.map((row) => [
    row.recordId,
    { [primaryFieldName]: buildOverview(row.fields, primaryField.name) },
  ]));
  updateRows(table.id, overviewUpdates);
  const updatedViews = updateViews(table.id);

  console.log(JSON.stringify({
    ok: true,
    tableName,
    renamedPrimaryField: renamed,
    internalRouteIdsBackfilled: Object.keys(routeUpdates).length,
    messageOverviewsBackfilled: Object.keys(overviewUpdates).length,
    updatedViews,
  }, null, 2));
}

main();

