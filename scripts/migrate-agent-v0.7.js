import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { computeV07Migration, V07_SCHEMA } from "../src/v0.7-schema.js";
import { loadConfig } from "../src/config.js";
import { larkCliInvocation } from "../src/lark-cli-process.js";

const config = loadConfig();
const root = config.root || process.cwd();
const apply = process.argv.includes("--apply");
const cli = process.env.LARK_CLI_ENTRY || config.larkCliEntry;

function run(args, { safeRetry = true } = {}) {
  const attempts = safeRetry ? 4 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const invocation = larkCliInvocation(cli, [...args, "--format", "json"]);
    const result = spawnSync(invocation.command, invocation.args, { cwd: root, encoding: "utf8", windowsHide: true });
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

function fieldJson(field) {
  if (field.type === "select") return { name: field.name, type: "select", multiple: false, options: field.options.map((name) => ({ name })), ...(field.defaultValue ? { default_value: [field.defaultValue] } : {}) };
  if (field.type === "user") return { name: field.name, type: "user", multiple: Boolean(field.multiple) };
  return { name: field.name, type: field.type };
}

function main() {
  const tableOutput = run(["base", "+table-list", "--base-token", config.baseToken, "--as", "user", "--limit", "100"]);
  const tables = tableOutput.data?.tables || [];
  const tableIds = Object.fromEntries(tables.map((table) => [table.name, table.id]));
  const existing = {};
  for (const table of tables) {
    if (!(table.name in V07_SCHEMA) && table.name !== "成员周成长记录") continue;
    const output = run(["base", "+field-list", "--base-token", config.baseToken, "--table-id", table.id, "--as", "user", "--limit", "200"]);
    existing[table.name] = (output.data?.fields || []).map((field) => field.name);
  }
  const plan = computeV07Migration(existing);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...plan }, null, 2));
  if (!apply) return;

  for (const item of plan.createTables) {
    const output = run(["base", "+table-create", "--base-token", config.baseToken, "--as", "user", "--name", item.tableName, "--fields", JSON.stringify(item.fields.map(fieldJson))], { safeRetry: false });
    tableIds[item.tableName] = output.data?.table?.id || output.data?.table_id || output.data?.id;
  }
  for (const item of plan.addFields) {
    run(["base", "+field-create", "--base-token", config.baseToken, "--table-id", tableIds[item.tableName], "--as", "user", "--json", JSON.stringify(fieldJson(item.field))], { safeRetry: false });
  }

  const weeklyTable = tableIds["成员周成长记录"];
  const updates = {};
  const weeklyStatusAdded = plan.addFields.some((item) => item.tableName === "成员周成长记录" && item.field.name === "AI审核状态");
  if (weeklyStatusAdded) {
    let offset = 0;
    while (true) {
      const rowsOutput = run(["base", "+record-list", "--base-token", config.baseToken, "--table-id", weeklyTable, "--as", "user", "--limit", "200", "--offset", String(offset), "--field-id", "AI审核状态"]);
      const data = rowsOutput.data || {};
      (data.data || []).forEach((row, index) => { if (!row[0]) updates[data.record_id_list[index]] = { "AI审核状态": "历史待处理" }; });
      if (!data.has_more || !(data.data || []).length) break;
      offset += data.data.length;
    }
  }
  if (Object.keys(updates).length) run(["base", "+record-batch-update", "--base-token", config.baseToken, "--table-id", weeklyTable, "--as", "user", "--json", JSON.stringify({ update_records: updates })]);
  console.log(JSON.stringify({ ok: true, message: "CloudAgent v0.7 additive migration applied", historicalRowsMarked: Object.keys(updates).length }, null, 2));
}

main();
