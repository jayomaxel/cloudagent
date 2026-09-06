import { AutoWriteService } from "./auto-write.js";
import { PeriodicReportService } from "./periodic-reports.js";
import { ReviewAnalyzer } from "./review-analyzer.js";
import { ReviewBaseGateway } from "./review-base-gateway.js";
import { WeeklyReviewWorkflow } from "./review-workflow.js";

export function createStandaloneReviewServices(config, { sendPrivate = null, gateway, analyzer } = {}) {
  const baseGateway = gateway || new ReviewBaseGateway(config);
  const reviewAnalyzer = analyzer || new ReviewAnalyzer(config);
  const autoWriter = new AutoWriteService({ gateway: baseGateway, config });
  const workflow = new WeeklyReviewWorkflow({ gateway: baseGateway, analyzer: reviewAnalyzer, autoWriter, config, sendPrivate });
  const reports = new PeriodicReportService({ gateway: baseGateway, analyzer: reviewAnalyzer, config });
  return { gateway: baseGateway, analyzer: reviewAnalyzer, autoWriter, workflow, reports };
}

export class WeeklyReviewRuntime {
  constructor({ config, lark, timers }) {
    this.config = config;
    this.lark = lark;
    this.timers = timers || [];
    this.running = new Set();
    this.services = createStandaloneReviewServices(config, {
      sendPrivate: (text, idempotencyKey) => lark?.sendPrivateText?.(config.weeklyReview.ownerOpenId, text, idempotencyKey)
    });
  }

  safeRun(label, operation) {
    if (this.running.has(label)) return Promise.resolve({ skipped: true, reason: "already_running" });
    this.running.add(label);
    return Promise.resolve().then(operation).catch((error) => console.error(`[weekly-review] ${label}失败`, error.message)).finally(() => this.running.delete(label));
  }

  start() {
    const reviewEvery = Math.max(Number(this.config.weeklyReview?.pollMinutes) || 15, 5) * 60000;
    const decisionEvery = Math.max(Number(this.config.weeklyReview?.decisionPollMinutes) || 10, 5) * 60000;
    const reportEvery = Math.max(Number(this.config.periodicReports?.pollMinutes) || 15, 5) * 60000;
    this.timers.push(setTimeout(() => this.safeRun("新问卷审核", () => this.services.workflow.processPendingWeeklySubmissions({ includeHistory: false })), 5000));
    this.timers.push(setInterval(() => this.safeRun("新问卷审核", () => this.services.workflow.processPendingWeeklySubmissions({ includeHistory: false })), reviewEvery));
    this.timers.push(setInterval(() => this.safeRun("人工审核决定同步", () => this.services.workflow.processHumanReviewDecisions()), decisionEvery));
    this.timers.push(setInterval(() => this.safeRun("待审核摘要", () => this.services.workflow.sendDueReviewDigest()), 60 * 60000));
    if (this.config.periodicReports?.enabled !== false) {
      this.timers.push(setTimeout(() => this.safeRun("周期报告", () => this.services.reports.generateDueReports()), 30000));
      this.timers.push(setInterval(() => this.safeRun("周期报告", () => this.services.reports.generateDueReports()), reportEvery));
    }
    console.log("[weekly-review] 每周问卷 AI 审核与周期报告运行时已启用");
  }

  stop() {
    for (const timer of this.timers.splice(0)) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.running.clear();
  }
}
