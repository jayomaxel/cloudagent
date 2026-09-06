import { loadConfig } from '../src/config.js';
import { LarkClient } from '../src/lark.js';
import { calculateShadowAudit } from '../src/shadow-audit.js';

function matrixRecords(output) {
  const data = output?.data || {};
  const fields = data.fields || [];
  return (data.data || []).map((row, index) => ({
    recordId: data.record_id_list?.[index] || '',
    fields: Object.fromEntries(fields.map((field, column) => [field, row[column]])),
  }));
}

function selectValue(value) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

const config = loadConfig();
const lark = new LarkClient(config);
const output = lark.listRecords(config.tables.messageRoutes, [
  '内部路由ID', '路由模式', '归属依据', '审核状态', '创建时间',
]);
const routes = matrixRecords(output).map((record) => ({
  routeId: String(record.fields['内部路由ID'] || ''),
  routeMode: selectValue(record.fields['路由模式']),
  basis: String(record.fields['归属依据'] || ''),
  reviewStatus: selectValue(record.fields['审核状态']),
  createdAt: record.fields['创建时间'] || '',
}));
const audit = calculateShadowAudit(routes, config.routing?.shadowAcceptance || {});

console.log(JSON.stringify({
  ...audit,
  precisionPercent: `${(audit.precision * 100).toFixed(2)}%`,
  elapsedDays: Number(audit.elapsedDays.toFixed(2)),
  generatedAt: new Date().toISOString(),
}, null, 2));
