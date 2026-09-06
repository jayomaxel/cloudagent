import { spawn } from "node:child_process";

const RESTART_DELAYS = [1_000, 5_000, 15_000, 60_000];

export function restartDelayMs(attempt) {
  return RESTART_DELAYS[Math.min(Math.max(Number(attempt) || 1, 1) - 1, RESTART_DELAYS.length - 1)];
}

export function runSupervisor({
  cwd = process.cwd(),
  args = ["src/index.js", "listen"],
  spawnImpl = spawn,
  stableRuntimeMs = 5 * 60 * 1000,
} = {}) {
  let child = null;
  let restartTimer = null;
  let stopping = false;
  let consecutiveFailures = 0;

  const startChild = () => {
    if (stopping) return;
    const startedAt = Date.now();
    child = spawnImpl(process.execPath, args, {
      cwd,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    console.log(`[supervisor] Agent 已启动，PID ${child.pid || "未知"}`);
    child.once("error", (error) => console.error("[supervisor] Agent 进程启动失败", error));
    child.once("exit", (code, signal) => {
      child = null;
      if (stopping) return;
      const runtime = Date.now() - startedAt;
      consecutiveFailures = runtime >= stableRuntimeMs ? 1 : consecutiveFailures + 1;
      const delay = restartDelayMs(consecutiveFailures);
      console.error(`[supervisor] Agent 已退出 code=${code} signal=${signal || "none"}，${delay / 1000} 秒后重启`);
      restartTimer = setTimeout(startChild, delay);
    });
  };

  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    if (child && !child.killed) child.kill("SIGTERM");
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  startChild();
  return { stop };
}

