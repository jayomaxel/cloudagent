import { loadConfig } from "../src/config.js";
import { LarkClient } from "../src/lark.js";

function recordsFrom(output) {
  const data = output?.data || {};
  const fields = data.fields || [];
  return (data.data || []).map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index]])));
}

function ids(value) {
  return [...new Set(String(value || "").split(/[、,;；\s]+/).map((item) => item.trim()).filter(Boolean))];
}

const config = loadConfig();
const lark = new LarkClient(config);
const existing = new Set(recordsFrom(lark.listRecords(config.tables.conclusionLedger, ["结论ID"])).map((row) => row["结论ID"]));
const routeLinks = new Map(recordsFrom(lark.listRecords(config.tables.messageRoutes, ["消息ID", "消息链接"]))
  .filter((row) => row["消息ID"] && row["消息链接"])
  .map((row) => [row["消息ID"], row["消息链接"]]));
const specs = [
  { table: config.tables.evidence, id: "事实ID", type: "贡献", text: "证据摘要", source: "消息ID", project: "所属项目", chat: "群聊ID", confidence: "置信度" },
  { table: config.tables.actions, id: "行动ID", type: "行动项", text: "行动项", source: "来源消息ID", project: "所属项目", chat: "群聊ID", confidence: "置信度" },
  { table: config.tables.decisions, id: "决策ID", type: "决策", text: "决策内容", source: "来源消息ID", project: "所属项目", chat: "群聊ID", confidence: "置信度" },
  { table: config.tables.topicSnapshots, id: "快照ID", type: "话题快照", text: "一句话总结", source: "来源消息ID", project: "所属项目", chat: "群聊ID", confidence: "置信度" }
];
const creates = [];
for (const spec of specs) {
  if (!spec.table) continue;
  const rows = recordsFrom(lark.listRecords(spec.table, [spec.id, spec.text, spec.source, spec.project, spec.chat, spec.confidence, "生成时间"]));
  for (const row of rows) {
    const claimId = String(row[spec.id] || "").trim();
    if (!claimId || existing.has(claimId)) continue;
    const sourceIds = ids(row[spec.source]);
    creates.push({
      "结论ID": claimId,
      "结论层级": "推断",
      "结论类型": spec.type,
      "结论正文": String(row[spec.text] || ""),
      "证据说明": "v0.6 历史迁移：原结论未经过事实/推断分层复核。",
      "所属项目": String(row[spec.project] || ""),
      "来源群ID": String(row[spec.chat] || ""),
      "来源消息ID": sourceIds.join("、"),
      "原始消息链接": sourceIds.map((id) => routeLinks.get(id)).filter(Boolean).join("\n"),
      "证据数量": sourceIds.length,
      "批次数量": 1,
      "置信度": Number(row[spec.confidence] || 0),
      "敏感等级": "低",
      "是否需要人工审核": true,
      "审核状态": "待审核",
      "Agent版本": config.agentVersion,
      "生成时间": row["生成时间"] || new Date().toISOString()
    });
    existing.add(claimId);
  }
}
lark.createRecords(config.tables.conclusionLedger, creates);
console.log(JSON.stringify({ ok: true, mode: "conservative-history-backfill", created: creates.length, modelCalls: 0 }, null, 2));
