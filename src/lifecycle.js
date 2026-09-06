export function clearRuntimeHandles(runtime) {
  for (const timer of runtime.timers || []) clearTimeout(timer);
  if (Array.isArray(runtime.timers)) runtime.timers.length = 0;

  for (const timer of runtime.retryTimers?.values?.() || []) clearTimeout(timer);
  runtime.retryTimers?.clear?.();

  for (const timer of runtime.notificationIdleTimers?.values?.() || []) clearTimeout(timer);
  runtime.notificationIdleTimers?.clear?.();

  try {
    runtime.stream?.stop?.();
  } finally {
    runtime.stream = null;
  }
}

export async function runOptionalStartupStep(operation, onError = () => {}) {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    onError(error);
    return { ok: false, error };
  }
}
