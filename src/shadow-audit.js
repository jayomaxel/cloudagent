const DAY_MS = 24 * 60 * 60 * 1000;
const DETERMINISTIC_BASES = ["群绑定", "汇报模板", "确认别名", "回复继承"];

function isDeterministicBasis(value) {
  const basis = String(value || "");
  return DETERMINISTIC_BASES.some((prefix) => basis.startsWith(prefix));
}

export function calculateShadowAudit(routes, options = {}) {
  const minimumDays = Number(options.minimumDays) || 3;
  const minimumAuditedMessages = Number(options.minimumAuditedMessages) || 30;
  const minimumDeterministicPrecision = Number(options.minimumDeterministicPrecision) || 0.95;
  const maximumDays = Number(options.maximumDays) || 7;
  const now = Number(options.now) || Date.now();
  const eligibleRoutes = (routes || []).filter((route) => (
    route.routeMode === "影子" && isDeterministicBasis(route.basis)
  ));
  const reviewedRoutes = eligibleRoutes.filter((route) => ["已确认", "已驳回"].includes(route.reviewStatus));
  const correct = reviewedRoutes.filter((route) => route.reviewStatus === "已确认").length;
  const incorrect = reviewedRoutes.filter((route) => route.reviewStatus === "已驳回").length;
  const timestamps = eligibleRoutes
    .map((route) => Date.parse(route.createdAt))
    .filter(Number.isFinite);
  const startedAtMs = timestamps.length ? Math.min(...timestamps) : null;
  const elapsedDays = startedAtMs === null ? 0 : Math.max(0, (now - startedAtMs) / DAY_MS);
  const precision = reviewedRoutes.length ? correct / reviewedRoutes.length : 0;
  const readyForManualPromotion = (
    elapsedDays >= minimumDays
    && reviewedRoutes.length >= minimumAuditedMessages
    && precision >= minimumDeterministicPrecision
  );
  return {
    eligible: eligibleRoutes.length,
    reviewed: reviewedRoutes.length,
    pendingReview: eligibleRoutes.length - reviewedRoutes.length,
    correct,
    incorrect,
    precision,
    elapsedDays,
    startedAt: startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
    minimumDays,
    maximumDays,
    minimumAuditedMessages,
    minimumDeterministicPrecision,
    readyForManualPromotion,
    recommendation: readyForManualPromotion
      ? "已达到门槛，可由人工决定是否切换正式模式"
      : elapsedDays >= maximumDays && reviewedRoutes.length < minimumAuditedMessages
        ? "已到最长观察期但样本不足，保持影子模式并补足人工审核"
        : "继续影子观察"
  };
}

