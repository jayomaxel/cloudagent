import { buildWeeklyReviewPayload, normalizeWeeklySubmission } from "./weekly-questionnaire.js";
import { decideReviewOutcome, REVIEW_STATUS, runDeterministicChecks } from "./review-policy.js";

function nowText() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" }).format(new Date());
}

function selectValue(value) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function userCell(openId) {
  return openId ? [{ id: openId }] : [];
}

function userId(value) {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === "string" ? item : item?.id || "";
}

const REVIEW_RETRY_DELAYS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function dateValue(value) {
  if (typeof value === "number") return new Date(value).toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
}

export function filterConfirmedRelatedEvidence(rows, context) {
  return rows.filter((row) => {
    const fields = row.fields || {};
    const member = String(fields["成员姓名"] || fields["成员名称"] || "");
    const project = String(fields["项目"] || fields["所属项目"] || "");
    const start = dateValue(fields["周期开始"] || fields["证据开始时间"]);
    const end = dateValue(fields["周期结束"] || fields["证据结束时间"]);
    return selectValue(fields["审核状态"]) === "已确认"
      && (!context.memberName || member === context.memberName)
      && (!context.projectName || project === context.projectName)
      && start <= context.periodEnd
      && end >= context.periodStart;
  });
}

export function nextReviewRetryState({ previousAttempts = 0, now = Date.now(), maxAttempts = 5 }) {
  const attempts = Number(previousAttempts || 0) + 1;
  const exhausted = attempts >= maxAttempts;
  const delay = REVIEW_RETRY_DELAYS[Math.min(Number(previousAttempts || 0), REVIEW_RETRY_DELAYS.length - 1)];
  return { attempts, retryAt: exhausted ? null : now + delay, exhausted };
}

export function parseReviewRetryAt(value) {
  if (typeof value === "number") return value;
  const text = String(value || "").trim();
  if (!text) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)) {
    return Date.parse(`${text.replace(" ", "T")}+08:00`);
  }
  return Date.parse(text);
}

export function isTerminalHumanDecision(status) {
  return ["确认", "修改后确认", "驳回", "调整项目", "标记共同贡献"].includes(status);
}

export function shouldRunAutomaticWrite(config, outcome) {
  return config?.autoWriteVerified === true && Boolean(outcome?.allowFormalWrite || outcome?.allowAutoWrite);
}

export class WeeklyReviewWorkflow {
  constructor({ gateway, analyzer, autoWriter, config, sendPrivate = null }) {
    this.gateway = gateway;
    this.analyzer = analyzer;
    this.autoWriter = autoWriter;
    this.config = config;
    this.sendPrivate = sendPrivate;
  }

  table(key, fallback) {
    return this.config.tables?.[key] || fallback;
  }

  loadMembers() {
    return this.gateway.listRecords(this.table("members", "成员档案"), ["姓名", "飞书成员", "成长阶段", "成员状态"]).map((record) => ({
      recordId: record.record_id,
      name: String(record.fields?.["姓名"] || ""),
      openId: userId(record.fields?.["飞书成员"]),
      stage: selectValue(record.fields?.["成长阶段"]),
      status: selectValue(record.fields?.["成员状态"])
    })).filter((member) => member.name || member.openId);
  }

  loadProjects() {
    return this.gateway.listRecords(this.table("projects", "项目库"), ["项目名称", "项目别名", "项目状态"]).map((record) => ({
      recordId: record.record_id,
      name: String(record.fields?.["项目名称"] || ""),
      aliases: String(record.fields?.["项目别名"] || "").split(/[，,、;；\n]/).map((item) => item.trim()).filter(Boolean),
      status: selectValue(record.fields?.["项目状态"])
    })).filter((project) => project.name);
  }

  loadRelatedEvidence(candidate) {
    const rows = this.gateway.listRecords(this.table("evidence", "Agent 贡献证据"), [
      "事实ID", "贡献成员", "所属项目", "证据摘要", "原始消息链接", "审核状态", "证据开始时间", "证据结束时间"
    ]);
    return rows.filter((record) => {
      const fields = record.fields || {};
      const sameMember = !candidate.memberOpenId || userId(fields["贡献成员"]) === candidate.memberOpenId;
      const sameProject = !candidate.projectName || !fields["所属项目"] || fields["所属项目"] === candidate.projectName;
      const start = dateValue(fields["证据开始时间"]);
      const end = dateValue(fields["证据结束时间"]);
      const samePeriod = Boolean(start && end && start <= candidate.periodEnd && end >= candidate.periodStart);
      return sameMember && sameProject && samePeriod && selectValue(fields["审核状态"]) === "已确认";
    }).slice(0, 20).map((record) => ({
      fact_id: record.fields?.["事实ID"] || "",
      summary: record.fields?.["证据摘要"] || "",
      links: String(record.fields?.["原始消息链接"] || "").split("\n").filter(Boolean),
      status: selectValue(record.fields?.["审核状态"])
    }));
  }

  existingFactIds() {
    return this.gateway.listRecords(this.table("evidence", "Agent 贡献证据"), ["事实ID"]).map((record) => String(record.fields?.["事实ID"] || "")).filter(Boolean);
  }

  existingReview(reviewId) {
    return this.gateway.findByField(this.table("aiReviews", "Agent AI审核记录"), "审核ID", reviewId, ["审核ID", "审核状态", "重试次数", "下次重试时间"]);
  }

  sourceRows({ includeHistory = false } = {}) {
    const fields = [
      "姓名", "成员", "周次", "本周目标完成情况", "本周具体工作&解决了什么问题", "我解决了什么问题",
      "本周可展示成果", "成果附件", "AI协作过程", "遇到的困难与需要的支持", "主动同步或协作了什么",
      "本周最满意&最不满意的一点", "当前项目或学习主题", "提交时间", "反馈状态", "对接人", "AI审核状态"
    ];
    return this.gateway.listRecords(this.table("weeklyGrowth", "成员周成长记录"), fields).filter((record) => {
      const status = selectValue(record.fields?.["AI审核状态"]);
      return !status || status === REVIEW_STATUS.FAILED || (includeHistory && status === REVIEW_STATUS.HISTORY);
    });
  }

  previewPending({ includeHistory = false, member = "", from = "", to = "", limit = 100 } = {}) {
    const members = this.loadMembers();
    const projects = this.loadProjects();
    return this.sourceRows({ includeHistory }).map((record) => normalizeWeeklySubmission(record, { members, projects, submissionGraceDays: this.config.weeklyReview?.submissionGraceDays ?? 1 })).filter((candidate) => {
      if (member && candidate.memberName !== member && candidate.memberOpenId !== member) return false;
      if (from && candidate.periodEnd < from) return false;
      if (to && candidate.periodStart > to) return false;
      return true;
    }).slice(0, limit).map((candidate) => ({
      recordId: candidate.recordId,
      member: candidate.memberName || candidate.memberOpenId,
      period: candidate.weekKey,
      projectCandidate: candidate.projectName || candidate.projectCandidate,
      estimatedModelCalls: 2
    }));
  }

  persistReview({ candidate, extraction, verification, checks, outcome, error = "", retryState = null }) {
    const reviewTable = this.table("aiReviews", "Agent AI审核记录");
    const fields = {
      "审核ID": candidate.reviewId,
      "来源记录ID": candidate.recordId,
      "来源类型": "成员周问卷",
      "周期": candidate.weekKey,
      "成员": userCell(candidate.memberOpenId),
      "成员名称": candidate.memberName,
      "所属项目": candidate.projectName || candidate.projectCandidate,
      "事实ID": candidate.factId,
      "候选内容": JSON.stringify(buildWeeklyReviewPayload(candidate)),
      "第一层提取": JSON.stringify(extraction || {}),
      "第二层审核": JSON.stringify(verification || {}),
      "证据等级": outcome?.evidenceGrade || verification?.evidence_grade || checks?.evidenceGrade || "C",
      "风险等级": verification?.risk_level || checks?.riskLevel || "中",
      "审核状态": outcome?.status || REVIEW_STATUS.FAILED,
      "需要人工审核": Boolean(outcome?.needsHumanReview),
      "允许正式写入": Boolean(outcome?.allowFormalWrite),
      "审核说明": error || verification?.rationale || checks?.errors?.join("；") || "",
      "证据链接": candidate.links.join("\n"),
      "审核模型": this.config.reviewModel || this.config.model,
      "创建时间": nowText(),
      "完成时间": nowText(),
      "重试次数": retryState?.attempts || 0,
      "下次重试时间": retryState?.retryAt ? new Date(retryState.retryAt).toISOString() : null,
      "Agent版本": this.config.agentVersion
    };
    const existing = this.existingReview(candidate.reviewId);
    if (existing?.record_id) this.gateway.updateRecords(reviewTable, { [existing.record_id]: fields });
    else this.gateway.createRecords(reviewTable, [fields]);

    this.gateway.updateRecords(this.table("weeklyGrowth", "成员周成长记录"), {
      [candidate.recordId]: {
        "成员": userCell(candidate.memberOpenId),
        "周期开始": candidate.periodStart,
        "周期结束": candidate.periodEnd,
        "所属项目": candidate.projectName || candidate.projectCandidate,
        "事实ID": candidate.factId,
        "证据等级": fields["证据等级"],
        "风险等级": fields["风险等级"],
        "AI审核状态": fields["审核状态"],
        "AI审核说明": fields["审核说明"],
        "AI审核时间": nowText(),
        "进入正式记录": fields["允许正式写入"]
      }
    });
  }

  ensureQueue({ candidate, verification, outcome }) {
    if (![REVIEW_STATUS.HUMAN, REVIEW_STATUS.SUPPLEMENT].includes(outcome.status)) return null;
    const queueTable = this.table("reviewQueue", "Agent 负责人审核队列");
    const itemId = `queue_${candidate.reviewId}`;
    const existing = this.gateway.findByField(queueTable, "事项ID", itemId, ["事项ID", "审核状态", "最后提醒时间", "提醒次数"]);
    const fields = {
      "事项ID": itemId,
      "审核ID": candidate.reviewId,
      "事项类型": outcome.status === REVIEW_STATUS.SUPPLEMENT ? "待成员补充" : "负责人审核",
      "成员": userCell(candidate.memberOpenId),
      "成员名称": candidate.memberName,
      "所属项目": candidate.projectName || candidate.projectCandidate,
      "风险等级": verification?.risk_level || "中",
      "事实摘要": verification?.rationale || candidate.summaryText.slice(0, 1000),
      "待确认问题": verification?.supplement_request || verification?.conflicts?.join("；") || "请确认证据与归属",
      "证据链接": candidate.links.join("\n"),
      "AI建议": verification?.suggested_action || "",
      "审核负责人": userCell(this.config.weeklyReview?.ownerOpenId),
      "审核状态": existing?.fields?.["审核状态"] || "待审核",
      "已执行": false,
      "创建时间": nowText(),
      "Agent版本": this.config.agentVersion
    };
    if (existing?.record_id) this.gateway.updateRecords(queueTable, { [existing.record_id]: fields });
    else this.gateway.createRecords(queueTable, [fields]);
    return { itemId, fields, existing };
  }

  async processOne(candidate, { notify = true, existingFactIds = [] } = {}) {
    const existing = this.existingReview(candidate.reviewId);
    const existingStatus = selectValue(existing?.fields?.["审核状态"]);
    if (existing && existingStatus !== REVIEW_STATUS.FAILED) return { status: "skipped", reason: "already_reviewed", candidate };
    const retryAtValue = existing?.fields?.["下次重试时间"];
    const retryAt = parseReviewRetryAt(retryAtValue);
    if (existing && Number.isFinite(retryAt) && retryAt > Date.now()) return { status: "skipped", reason: "retry_not_due", candidate };
    const relatedEvidence = this.loadRelatedEvidence(candidate);
    candidate.independentSources = Math.max(candidate.independentSources, relatedEvidence.length);
    const checks = runDeterministicChecks(candidate, { existingFactIds });
    let extraction = { summary: candidate.summaryText, facts: [], contribution_claim: false };
    let verification = {
      verdict: checks.duplicate ? "reject_duplicate" : "human_review",
      evidence_grade: checks.evidenceGrade,
      risk_level: checks.riskLevel,
      conflicts: checks.errors,
      rationale: checks.errors.join("；") || checks.warnings.join("；") || "确定性检查完成",
      accepted_fact_indexes: [], rejected_fact_indexes: []
    };
    try {
      if (!checks.duplicate && !checks.errors.includes("成员身份无法确认") && candidate.summaryText) {
        const payload = buildWeeklyReviewPayload(candidate, relatedEvidence);
        extraction = await this.analyzer.extractWeeklyCandidate(payload);
        verification = await this.analyzer.verifyWeeklyCandidate({ payload, deterministic_checks: checks, first_stage: extraction }, { highRisk: checks.riskLevel === "高" });
      }
      const outcome = decideReviewOutcome({ checks, extraction, verification });
      this.persistReview({ candidate, extraction, verification, checks, outcome });
      if (shouldRunAutomaticWrite(this.config.weeklyReview, outcome)) this.autoWriter.applyVerifiedReview({ candidate, extraction, verification, outcome });
      const queued = this.ensureQueue({ candidate, verification, outcome });
      if (notify && queued && (verification.risk_level === "高" || checks.riskLevel === "高") && this.sendPrivate && !queued.existing?.fields?.["最后提醒时间"]) {
        await this.sendPrivate(
          `【CloudAgent 高风险审核】\n成员：${candidate.memberName || candidate.memberOpenId}\n项目：${candidate.projectName || candidate.projectCandidate || "待确认"}\n原因：${verification.rationale}\n请在“Agent 负责人审核队列”处理。`,
          `weekly-review-high-${candidate.reviewId}`
        );
        const row = this.gateway.findByField(this.table("reviewQueue", "Agent 负责人审核队列"), "事项ID", queued.itemId, ["事项ID"]);
        if (row?.record_id) this.gateway.updateRecords(this.table("reviewQueue", "Agent 负责人审核队列"), { [row.record_id]: { "最后提醒时间": nowText(), "提醒次数": 1 } });
      }
      return { status: outcome.status, candidate, checks, extraction, verification, outcome };
    } catch (error) {
      const retryState = nextReviewRetryState({ previousAttempts: Number(existing?.fields?.["重试次数"] || 0), maxAttempts: 5 });
      const outcome = retryState.exhausted
        ? { status: REVIEW_STATUS.HUMAN, allowFormalWrite: false, needsHumanReview: true }
        : { status: REVIEW_STATUS.FAILED, allowFormalWrite: false, needsHumanReview: false };
      verification = { ...verification, verdict: "human_review", risk_level: checks.riskLevel || "中", rationale: retryState.exhausted ? "模型审核连续失败，已转负责人审核" : "模型审核暂时失败，等待自动重试" };
      this.persistReview({ candidate, extraction, verification, checks, outcome, error: String(error.message || error).slice(0, 1000), retryState });
      if (retryState.exhausted) this.ensureQueue({ candidate, verification, outcome });
      return { status: outcome.status, candidate, error, retryState };
    }
  }

  async processPendingWeeklySubmissions({ includeHistory = false, member = "", from = "", to = "", limit = 20, notify = true } = {}) {
    const members = this.loadMembers();
    const projects = this.loadProjects();
    const existingFactIds = this.existingFactIds();
    const candidates = this.sourceRows({ includeHistory }).map((record) => normalizeWeeklySubmission(record, { members, projects, submissionGraceDays: this.config.weeklyReview?.submissionGraceDays ?? 1 })).filter((candidate) => {
      if (member && candidate.memberName !== member && candidate.memberOpenId !== member) return false;
      if (from && candidate.periodEnd < from) return false;
      if (to && candidate.periodStart > to) return false;
      return true;
    }).slice(0, limit);
    const results = [];
    for (const candidate of candidates) results.push(await this.processOne(candidate, { notify, existingFactIds }));
    return results;
  }

  async processHumanReviewDecisions() {
    const table = this.table("reviewQueue", "Agent 负责人审核队列");
    const rows = this.gateway.listRecords(table, ["事项ID", "审核ID", "审核状态", "已执行", "人工修订", "调整后项目", "共同贡献者"]);
    const actionable = rows.filter((row) => !row.fields?.["已执行"] && isTerminalHumanDecision(selectValue(row.fields?.["审核状态"])));
    const results = [];
    for (const row of actionable) {
      const status = selectValue(row.fields["审核状态"]);
      if (["确认", "修改后确认", "调整项目", "标记共同贡献"].includes(status)) {
        const review = this.gateway.findByField(this.table("aiReviews", "Agent AI审核记录"), "审核ID", row.fields["审核ID"], ["审核ID", "候选内容", "第一层提取", "第二层审核"]);
        if (!review) {
          results.push({ itemId: row.fields["事项ID"], status, executed: false, error: "找不到对应审核记录" });
          continue;
        }
        if (status === "调整项目" && !String(row.fields["调整后项目"] || "").trim()) {
          results.push({ itemId: row.fields["事项ID"], status, executed: false, error: "调整项目需要填写调整后项目" });
          continue;
        }
        {
          const payload = JSON.parse(review.fields["候选内容"] || "{}");
          const candidate = {
            recordId: payload.record_id, reviewId: payload.review_id, factId: payload.fact_id,
            memberOpenId: payload.member?.open_id || "", memberName: payload.member?.name || "",
            projectName: row.fields["调整后项目"] || payload.project?.confirmed_name || "",
            projectCandidate: payload.project?.submitted_topic || "", periodStart: payload.period?.start,
            periodEnd: payload.period?.end, weekKey: payload.period?.key, links: payload.artifact_links || [], independentSources: 2
          };
          const member = this.loadMembers().find((item) => item.openId === candidate.memberOpenId);
          candidate.memberRecordId = member?.recordId || "";
          const allMembers = this.loadMembers();
          const contributorIds = (Array.isArray(row.fields["共同贡献者"]) ? row.fields["共同贡献者"] : []).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
          const contributors = allMembers.filter((item) => contributorIds.includes(item.openId));
          const extraction = JSON.parse(review.fields["第一层提取"] || "{}");
          if (row.fields["人工修订"]) extraction.summary = String(row.fields["人工修订"]);
          const verification = JSON.parse(review.fields["第二层审核"] || "{}");
          this.autoWriter.applyVerifiedReview({ candidate, extraction, verification, outcome: { status: REVIEW_STATUS.AUTO, allowFormalWrite: true }, humanOverride: true, contributors });
          this.gateway.updateRecords(this.table("aiReviews", "Agent AI审核记录"), { [review.record_id]: { "审核状态": REVIEW_STATUS.AUTO, "需要人工审核": false, "允许正式写入": true, "所属项目": candidate.projectName, "审核说明": `负责人${status}` } });
          if (candidate.recordId) this.gateway.updateRecords(this.table("weeklyGrowth", "成员周成长记录"), { [candidate.recordId]: { "AI审核状态": REVIEW_STATUS.AUTO, "AI审核说明": `负责人${status}`, "所属项目": candidate.projectName, "进入正式记录": true, "AI审核时间": nowText() } });
        }
      } else if (status === "驳回") {
        const review = this.gateway.findByField(this.table("aiReviews", "Agent AI审核记录"), "审核ID", row.fields["审核ID"], ["审核ID", "来源记录ID"]);
        if (!review) {
          results.push({ itemId: row.fields["事项ID"], status, executed: false, error: "找不到对应审核记录" });
          continue;
        }
        this.gateway.updateRecords(this.table("aiReviews", "Agent AI审核记录"), { [review.record_id]: { "审核状态": REVIEW_STATUS.HUMAN, "需要人工审核": false, "允许正式写入": false, "审核说明": "负责人驳回" } });
        if (review.fields?.["来源记录ID"]) this.gateway.updateRecords(this.table("weeklyGrowth", "成员周成长记录"), { [review.fields["来源记录ID"]]: { "AI审核状态": REVIEW_STATUS.HUMAN, "AI审核说明": "负责人驳回", "进入正式记录": false, "AI审核时间": nowText() } });
      }
      this.gateway.updateRecords(table, { [row.record_id]: { "已执行": true, "执行时间": nowText() } });
      results.push({ itemId: row.fields["事项ID"], status, executed: true });
    }
    return results;
  }

  async sendDueReviewDigest(now = new Date()) {
    if (!this.sendPrivate) return { sent: false, count: 0 };
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    if (hour !== Number(this.config.weeklyReview?.digestHour ?? 18)) return { sent: false, count: 0 };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", dateStyle: "short" }).format(now);
    const table = this.table("reviewQueue", "Agent 负责人审核队列");
    const rows = this.gateway.listRecords(table, ["事项ID", "成员名称", "所属项目", "风险等级", "待确认问题", "审核状态", "最后提醒时间", "提醒次数"]);
    const due = rows.filter((row) => selectValue(row.fields?.["审核状态"]) === "待审核" && row.fields?.["风险等级"] !== "高" && !String(row.fields?.["最后提醒时间"] || "").startsWith(today));
    if (!due.length) return { sent: false, count: 0 };
    const lines = due.slice(0, 20).map((row, index) => `${index + 1}. ${row.fields["成员名称"] || "成员待确认"}｜${row.fields["所属项目"] || "项目待确认"}｜${row.fields["待确认问题"] || "请审核"}`);
    await this.sendPrivate(`【CloudAgent 每日待审核摘要】\n共 ${due.length} 项，仅包含无法确认或需要人工判断的内容。\n${lines.join("\n")}\n请在“Agent 负责人审核队列”集中处理。`, `weekly-review-digest-${today}`);
    const updates = {};
    for (const row of due) updates[row.record_id] = { "最后提醒时间": nowText(), "提醒次数": Number(row.fields?.["提醒次数"] || 0) + 1 };
    this.gateway.updateRecords(table, updates);
    return { sent: true, count: due.length };
  }
}
