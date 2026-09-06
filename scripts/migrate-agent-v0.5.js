import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  AGENT_SCHEMA,
  DEFAULT_PROJECT_ALIASES,
  FIELD_ADDITIONS,
  computeMigrationPlan,
} from '../src/migration-plan.js';

const BASE_TOKEN = process.env.LARK_BASE_TOKEN || 'WGq3bSaOga59t5sXtRBch647nBh';
const CLI = process.env.LARK_CLI_PATH || (
  process.platform === 'win32'
    ? 'C:\\Users\\jayomaxel\\AppData\\Roaming\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js'
    : 'lark-cli'
);
const APPLY = process.argv.includes('--apply');

function run(args, { json = true, retries = 0 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const executable = CLI.endsWith('.js') ? process.execPath : CLI;
    const executableArgs = CLI.endsWith('.js') ? [CLI, ...args] : args;
    const result = spawnSync(executable, executableArgs, { encoding: 'utf8', shell: false });
    if (result.error) lastError = result.error;
    else if (result.status !== 0) lastError = new Error(result.stderr || result.stdout || `lark-cli exited ${result.status}`);
    else if (!json) return result.stdout;
    else {
      const payload = JSON.parse(result.stdout);
      if (payload.ok !== false) return payload;
      lastError = new Error(payload.error?.message || result.stdout);
    }
  }
  throw lastError;
}

function baseArgs(command, extra = []) {
  return ['base', command, '--base-token', BASE_TOKEN, ...extra, '--format', 'json'];
}

function listTables() {
  return run(baseArgs('+table-list', ['--limit', '100']), { retries: 2 }).data?.tables || [];
}

function listFields(tableId) {
  return run(baseArgs('+field-list', ['--table-id', tableId, '--limit', '200']), { retries: 2 }).data?.fields || [];
}

function fieldJson(field, tableIds) {
  if (field.type === 'select') {
    return { name: field.name, type: 'select', multiple: false, options: field.options.map((name) => ({ name })) };
  }
  if (field.type === 'date') return { name: field.name, type: 'datetime' };
  if (field.type === 'user') return { name: field.name, type: 'user', multiple: Boolean(field.multiple) };
  if (field.type === 'link') {
    return { name: field.name, type: 'link', link_table: tableIds[field.tableName] };
  }
  return { name: field.name, type: field.type };
}

function createTable(tableName, fields, tableIds) {
  const payload = fields.map((field) => fieldJson(field, tableIds));
  return run(baseArgs('+table-create', ['--name', tableName, '--fields', JSON.stringify(payload)]), { retries: 2 });
}

function addField(tableId, field, tableIds) {
  return run(baseArgs('+field-create', ['--table-id', tableId, '--json', JSON.stringify(fieldJson(field, tableIds))]), { retries: 2 });
}

function listRecords(tableId, fields) {
  const args = ['base', '+record-list', '--base-token', BASE_TOKEN, '--table-id', tableId, '--limit', '200', '--format', 'json'];
  for (const field of fields) args.push('--field-id', field);
  const output = run(args, { retries: 2 }).data || {};
  if (Array.isArray(output.records)) return output.records;
  const names = output.fields || fields;
  return (output.data || []).map((row, index) => ({
    record_id: output.record_id_list?.[index],
    fields: Object.fromEntries(names.map((name, column) => [name, row[column]])),
  }));
}

function recordFields(record) {
  return record.fields || record.record?.fields || {};
}

function recordId(record) {
  return record.record_id || record.recordId || record.id;
}

function updateRecords(tableId, updates) {
  if (!Object.keys(updates).length) return null;
  return run(baseArgs('+record-batch-update', ['--table-id', tableId, '--json', JSON.stringify({ update_records: updates })]));
}

function printPlan(plan, aliasUpdates, groupUpdates) {
  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    createTables: plan.createTables.map((item) => item.tableName),
    addFields: plan.addFields.map((item) => `${item.tableName}.${item.field.name}`),
    aliasUpdates,
    groupUpdates,
    destructiveChanges: plan.destructiveChanges,
  }, null, 2));
}

function desiredGroupRouting(name, enabled, projectName, formalProjectNames) {
  if (!enabled || /团队开发群/.test(name)) {
    return { '群聊类型': '排除', '允许多项目归属': false, '路由模式': '关闭', '分析组织管理': false };
  }
  if (name === '开发组') {
    return { '群聊类型': '混合', '允许多项目归属': true, '路由模式': '影子', '分析组织管理': true };
  }
  if (formalProjectNames.has(projectName)) {
    return { '群聊类型': '项目专属', '允许多项目归属': false, '路由模式': '正式', '分析组织管理': false };
  }
  return { '群聊类型': '混合', '允许多项目归属': true, '路由模式': '影子', '分析组织管理': true };
}

function sameValue(a, b) {
  if (Array.isArray(a)) return a.length === 1 && a[0] === b;
  return a === b;
}

function main() {
  const tables = listTables();
  const tableIds = Object.fromEntries(tables.map((table) => [table.name, table.id]));
  const snapshot = { tables: {} };
  const neededTables = new Set([...Object.keys(AGENT_SCHEMA), ...Object.keys(FIELD_ADDITIONS)]);
  for (const table of tables) {
    if (neededTables.has(table.name)) snapshot.tables[table.name] = listFields(table.id).map((field) => field.name);
  }
  const plan = computeMigrationPlan(snapshot);

  const projectFields = ['项目名称', '项目别名'].filter((name) => snapshot.tables['项目库'].includes(name));
  const projectRecords = listRecords(tableIds['项目库'], projectFields);
  const aliasUpdates = [];
  const aliasWrites = {};
  const formalProjectNames = new Set();
  for (const record of projectRecords) {
    const fields = recordFields(record);
    const projectName = fields['项目名称'];
    if (projectName) formalProjectNames.add(projectName);
    const desired = DEFAULT_PROJECT_ALIASES[projectName];
    if (!desired) continue;
    const existing = String(fields['项目别名'] || '').split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean);
    const merged = [...new Set([...existing, ...desired])];
    if (merged.join('，') !== existing.join('，')) {
      aliasUpdates.push({ projectName, aliases: merged });
      aliasWrites[recordId(record)] = { '项目别名': merged.join('，') };
    }
  }

  const groupFields = [
    '群聊名称', '所属项目', '启用分析', '群聊类型', '允许多项目归属', '路由模式', '分析组织管理',
  ].filter((name) => snapshot.tables['Agent 群聊配置'].includes(name));
  const groupRecords = listRecords(tableIds['Agent 群聊配置'], groupFields);
  const groupUpdates = [];
  const groupWrites = {};
  for (const record of groupRecords) {
    const fields = recordFields(record);
    const desired = desiredGroupRouting(
      fields['群聊名称'], Boolean(fields['启用分析']), fields['所属项目'], formalProjectNames,
    );
    const changed = Object.entries(desired).some(([key, value]) => !sameValue(fields[key], value));
    if (!changed) continue;
    groupUpdates.push({ groupName: fields['群聊名称'], ...desired });
    groupWrites[recordId(record)] = desired;
  }

  printPlan(plan, aliasUpdates, groupUpdates);
  if (!APPLY) return;

  for (const item of plan.createTables) {
    const response = createTable(item.tableName, item.fields, tableIds);
    const created = response.data?.table || response.data;
    tableIds[item.tableName] = created?.id || created?.table_id;
  }
  for (const item of plan.addFields) {
    if (!tableIds[item.tableName]) throw new Error(`table not found after create: ${item.tableName}`);
    addField(tableIds[item.tableName], item.field, tableIds);
  }
  updateRecords(tableIds['项目库'], aliasWrites);
  updateRecords(tableIds['Agent 群聊配置'], groupWrites);
  console.log(JSON.stringify({ ok: true, message: 'Agent v0.5 additive migration applied.' }, null, 2));
}

main();
