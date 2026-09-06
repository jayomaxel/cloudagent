export function normalizeModelUsage(usage = {}) {
  const inputTokens = Number(usage.inputTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.outputTokens ?? usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage.totalTokens ?? usage.total_tokens ?? (inputTokens + outputTokens)) || 0;
  const cachedInputTokens = Number(
    usage.cachedInputTokens
    ?? usage.prompt_cache_hit_tokens
    ?? usage.input_tokens_details?.cached_tokens
    ?? usage.prompt_tokens_details?.cached_tokens
    ?? 0
  ) || 0;
  return { inputTokens, outputTokens, totalTokens, cachedInputTokens };
}

export function estimateModelCost(usage, pricing = {}) {
  const normalized = normalizeModelUsage(usage);
  const inputRate = Number(pricing.inputPerMillion);
  const outputRate = Number(pricing.outputPerMillion);
  const cachedRate = Number(pricing.cachedInputPerMillion);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null;
  const uncachedInput = Math.max(normalized.inputTokens - normalized.cachedInputTokens, 0);
  const cachedInputCost = normalized.cachedInputTokens > 0
    ? normalized.cachedInputTokens * (Number.isFinite(cachedRate) ? cachedRate : inputRate) / 1_000_000
    : 0;
  return uncachedInput * inputRate / 1_000_000
    + cachedInputCost
    + normalized.outputTokens * outputRate / 1_000_000;
}

export function runtimeStatus({ requestedStatus = "运行中", retryCount = 0, consecutiveFailures = 0 } = {}) {
  if (["启动中", "已停止", "离线"].includes(requestedStatus)) return requestedStatus;
  return retryCount > 0 || consecutiveFailures > 0 ? "降级运行" : "运行中";
}

export function heartbeatIsStale(lastHeartbeat, now = Date.now(), staleMinutes = 10) {
  const timestamp = Date.parse(lastHeartbeat);
  if (!Number.isFinite(timestamp)) return true;
  return now - timestamp >= Math.max(Number(staleMinutes) || 10, 1) * 60 * 1000;
}
