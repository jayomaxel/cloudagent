import fs from "node:fs";
import path from "node:path";
import { sanitizeMessages } from "./security.js";

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];

export function shouldPrunePendingBatch(batch, { now = Date.now(), retentionDays = 30, maxAttempts = 5 } = {}) {
  const savedAt = Date.parse(batch?.savedAt || "");
  if (!Number.isFinite(savedAt)) return false;
  return now - savedAt > retentionDays * 86400000 && Number(batch?.retryAttempt || 0) >= maxAttempts;
}

export function retryDelayMs(attempt) {
  return RETRY_DELAYS_MS[Number(attempt) - 1] ?? null;
}

export function remainingRetryDelayMs(retryAt, now = Date.now()) {
  const target = Number(retryAt || 0);
  const current = Number(now || 0);
  if (!Number.isFinite(target) || !Number.isFinite(current) || target <= current) return 0;
  return target - current;
}

export function failureTransition({ attempt, now = Date.now(), error }) {
  const delay = retryDelayMs(attempt);
  return {
    status: delay === null ? "永久失败" : "待重试",
    attempt,
    nextRetryAt: delay === null ? null : now + delay,
    error: String(error?.message || error || "未知错误")
  };
}

export function isBatchAlreadyProcessed(batch, processedMessageIds) {
  const messageIds = (batch?.messages || []).map((message) => message.message_id).filter(Boolean);
  return messageIds.length > 0 && messageIds.every((messageId) => processedMessageIds.has(messageId));
}

export function isMessageAvailableForAnalysis(message, processedMessageIds, inFlightMessageIds) {
  const messageId = String(message?.message_id || "").trim();
  return Boolean(messageId)
    && !processedMessageIds.has(messageId)
    && !inFlightMessageIds.has(messageId);
}

export function shouldReconcileBatchState(messageIdsValue, status, processedMessageIds) {
  if (status === "成功") return false;
  const messageIds = String(messageIdsValue || "").split(/[,，;；\s]+/).map((item) => item.trim()).filter(Boolean);
  return messageIds.length > 0 && messageIds.every((messageId) => processedMessageIds.has(messageId));
}

export async function runReliableOperation({ batchId, attempt, operation, onTransition }) {
  await onTransition({ status: "处理中", batchId, attempt });
  try {
    const result = await operation();
    await onTransition({ status: "成功", batchId, attempt });
    return result;
  } catch (error) {
    try {
      await onTransition({ batchId, ...failureTransition({ attempt, error }) });
    } catch (transitionError) {
      if (error && typeof error === "object") error.transitionError = transitionError;
    }
    throw error;
  }
}

export class PendingBatchStore {
  constructor(directory) {
    this.directory = directory;
  }

  filePath(batchId) {
    if (!/^batch_[a-z0-9_-]+$/i.test(String(batchId || ""))) throw new Error("批次 ID 格式无效");
    return path.join(this.directory, `${batchId}.json`);
  }

  save(batch) {
    fs.mkdirSync(this.directory, { recursive: true });
    const sanitized = sanitizeMessages(batch.messages || []);
    const payload = {
      ...batch,
      messages: sanitized.messages,
      redactionTypes: [...new Set([...(batch.redactionTypes || []), ...sanitized.detections])],
      savedAt: new Date().toISOString()
    };
    const target = this.filePath(batch.batchId);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(temporary, target);
    return payload;
  }

  load(batchId) {
    return JSON.parse(fs.readFileSync(this.filePath(batchId), "utf8"));
  }

  list() {
    if (!fs.existsSync(this.directory)) return [];
    return fs.readdirSync(this.directory)
      .filter((name) => /^batch_[a-z0-9_-]+\.json$/i.test(name))
      .map((name) => JSON.parse(fs.readFileSync(path.join(this.directory, name), "utf8")));
  }

  remove(batchId) {
    fs.rmSync(this.filePath(batchId), { force: true });
  }

  prune(options = {}) {
    const removed = [];
    for (const batch of this.list()) {
      if (!shouldPrunePendingBatch(batch, options)) continue;
      this.remove(batch.batchId);
      removed.push(batch.batchId);
    }
    return removed;
  }
}
