const LEVELS = new Set(["事实", "推断", "评价"]);
const CONFIRMED_STATUSES = new Set(["自动确认", "已确认", "已修正"]);

function messageTimestamp(message) {
  const raw = String(message?.create_time || "").trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  return Date.parse(raw.replace(" ", "T"));
}

export function normalizeClaimLevel(value, fallback = "推断") {
  return LEVELS.has(value) ? value : fallback;
}

export function deriveEvidence(sourceMessageIds, messages) {
  const byId = new Map((messages || []).map((message) => [message.message_id, message]));
  const ids = [...new Set(sourceMessageIds || [])].filter((id) => byId.has(id));
  if (!ids.length) return null;
  const selected = ids.map((id) => byId.get(id));
  const timestamps = selected.map(messageTimestamp).filter(Number.isFinite).sort((a, b) => a - b);
  const links = [...new Set(selected.map((message) => message.message_app_link).filter(Boolean))];
  return {
    ids,
    count: ids.length,
    startedAt: timestamps.length ? new Date(timestamps[0]).toISOString() : "",
    endedAt: timestamps.length ? new Date(timestamps.at(-1)).toISOString() : "",
    links
  };
}

export function claimReviewStatus(level, { needsHumanReview = false, identityRequiresReview = false } = {}) {
  if (level !== "事实" || needsHumanReview || identityRequiresReview) return "待审核";
  return "自动确认";
}

export function eligibleConfirmedFacts(rows, { now = Date.now(), windowDays = 7 } = {}) {
  const cutoff = now - Math.max(Number(windowDays) || 7, 1) * 24 * 60 * 60 * 1000;
  return (rows || []).filter((row) => {
    const endedAt = Date.parse(row.evidenceEndedAt || row.createdAt || "");
    return row.level === "事实"
      && CONFIRMED_STATUSES.has(row.reviewStatus)
      && Number.isFinite(endedAt)
      && endedAt >= cutoff;
  });
}

export function validateWorkStyleObservation(observation, availableFacts) {
  const factById = new Map((availableFacts || []).map((fact) => [fact.claimId, fact]));
  const sourceClaimIds = [...new Set(observation?.source_claim_ids || [])].filter((id) => factById.has(id));
  const batchIds = new Set(sourceClaimIds.map((id) => factById.get(id)?.batchId).filter(Boolean));
  if (sourceClaimIds.length < 3 || batchIds.size < 2) return null;
  return { ...observation, sourceClaimIds, batchIds: [...batchIds] };
}

export function canLinkEvaluationToMember(row, mode = "shadow") {
  return mode === "formal"
    && row.level === "评价"
    && ["已确认", "已修正"].includes(row.reviewStatus)
    && Number(row.evidenceCount) >= 3
    && Number(row.batchCount) >= 2;
}
