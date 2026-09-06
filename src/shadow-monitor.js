import fs from "node:fs";
import path from "node:path";

export function shadowAuditNotificationKind(audit) {
  if (!audit?.startedAt) return "";
  if (audit.readyForManualPromotion) return "ready";
  if (
    Number(audit.elapsedDays) >= Number(audit.maximumDays)
    && Number(audit.reviewed) < Number(audit.minimumAuditedMessages)
  ) return "insufficient";
  return "";
}

export function pendingShadowAuditReviewers(audit, state, reviewerIds) {
  const kind = shadowAuditNotificationKind(audit);
  if (!kind) return { kind: "", key: "", reviewerIds: [] };
  const key = `${kind}:${audit.startedAt}`;
  const notified = new Set(state?.notifications?.[key] || []);
  return {
    kind,
    key,
    reviewerIds: [...new Set(reviewerIds || [])].filter((openId) => openId && !notified.has(openId))
  };
}

export function markShadowAuditReviewerNotified(state, key, openId) {
  const current = state && typeof state === "object" ? state : {};
  const notifications = { ...(current.notifications || {}) };
  notifications[key] = [...new Set([...(notifications[key] || []), openId])];
  return { ...current, notifications };
}

export function loadShadowAcceptanceState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export function saveShadowAcceptanceState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

export function formatShadowAuditNotification(audit, kind, reviewUrl = "") {
  const precision = `${(Number(audit.precision) * 100).toFixed(2)}%`;
  const progress = [
    `观察时间：${Number(audit.elapsedDays).toFixed(1)} / ${audit.minimumDays} 天`,
    `已审核确定性路由：${audit.reviewed} / ${audit.minimumAuditedMessages} 条`,
    `确定性精确率：${precision} / ${(Number(audit.minimumDeterministicPrecision) * 100).toFixed(0)}%`,
    `待审核：${audit.pendingReview} 条`
  ].join("\n");
  const link = reviewUrl ? `\n审核入口：${reviewUrl}` : "";
  if (kind === "ready") {
    return `CloudAgent 影子路由已达到人工验收门槛。\n\n${progress}\n\n系统不会自动切换正式模式，请人工复核后决定是否晋级。${link}`;
  }
  return `CloudAgent 影子路由已达到最长观察期，但人工审核样本仍不足。\n\n${progress}\n\n系统将继续保持影子模式，请补足真实审核样本。${link}`;
}
