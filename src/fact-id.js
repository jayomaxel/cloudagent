import crypto from "node:crypto";

function canonicalText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function digest(parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map(canonicalText).join("\u001f"), "utf8")
    .digest("hex")
    .slice(0, 32);
}

function stableIds(values) {
  return [...new Set((values || []).map(String).filter(Boolean))].sort().join(",");
}

export function buildFactId({ type, projectId = "", subjectId = "", sourceMessageIds = [], content = "" }) {
  return `fact_${digest([type, projectId, subjectId, stableIds(sourceMessageIds), content])}`;
}

export function buildRouteId({ messageId, scopeType, projectId = "" }) {
  return `route_${digest([messageId, scopeType, projectId])}`;
}

export function buildBatchId({ chatId, source, messageIds = [] }) {
  return `batch_${digest([chatId, source, stableIds(messageIds)])}`;
}

export function contentFingerprint(content) {
  return digest([content]);
}
