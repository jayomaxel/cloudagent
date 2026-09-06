const DEFAULT_RESTART_DELAYS = [1_000, 5_000, 15_000, 60_000];

export class ReviewWorkerSupervisor {
  constructor({ spawnWorker, schedule = setTimeout, clearSchedule = clearTimeout, logger = console, restartDelays = DEFAULT_RESTART_DELAYS }) {
    if (typeof spawnWorker !== "function") throw new TypeError("spawnWorker is required");
    this.spawnWorker = spawnWorker;
    this.schedule = schedule;
    this.clearSchedule = clearSchedule;
    this.logger = logger;
    this.restartDelays = restartDelays;
    this.child = null;
    this.restartTimer = null;
    this.restartAttempt = 0;
    this.stopping = false;
  }

  start() {
    if (!this.child && !this.stopping) this.spawnNow();
  }

  spawnNow() {
    if (this.stopping) return;
    const child = this.spawnWorker();
    this.child = child;
    this.logger.info?.(`[review-worker] started pid=${child?.pid ?? "unknown"}`);
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.stopping) return;
      const index = Math.min(this.restartAttempt, this.restartDelays.length - 1);
      const delay = this.restartDelays[index];
      this.restartAttempt += 1;
      this.logger.warn?.(`[review-worker] exited code=${code} signal=${signal}; restart in ${delay}ms`);
      this.restartTimer = this.schedule(() => {
        this.restartTimer = null;
        this.spawnNow();
      }, delay);
    });
    child.once("error", (error) => this.logger.error?.(`[review-worker] process error: ${error.message}`));
  }

  stop() {
    this.stopping = true;
    if (this.restartTimer) {
      this.clearSchedule(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
  }
}

