import { stableId } from "./review-policy.js";

export function filterQueueForCurrentReviews(queue, currentReviewIds) {
  const ids = new Set(currentReviewIds.map(String));
  return queue.filter((row) => ids.has(String(row.reviewId ?? row.fields?.["审核ID"] ?? "")));
}

export function shouldEscalatePeriodicVerification(verification) {
  if (!verification || verification.verdict !== "auto_pass") return true;
  if (verification.risk_level === "高") return true;
  return Array.isArray(verification.conflicts) && verification.conflicts.length > 0;
}

function localDateParts(value, timezone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(value);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

export function periodKey(type, now = new Date(), timezone = "Asia/Shanghai") {
  const local = localDateParts(now, timezone);
  const midnight = Date.UTC(local.year, local.month - 1, local.day);
  if (type === "week") {
    const weekday = new Date(midnight).getUTCDay();
    const currentMonday = midnight - ((weekday + 6) % 7) * 86400000;
    const start = new Date(currentMonday - 7 * 86400000);
    const end = new Date(currentMonday - 86400000);
    return { type, start: ymd(start), end: ymd(end), key: `${ymd(start)}_${ymd(end)}` };
  }
  const start = new Date(Date.UTC(local.year, local.month - 2, 1));
  const end = new Date(Date.UTC(local.year, local.month - 1, 0));
  return { type, start: ymd(start), end: ymd(end), key: ymd(start).slice(0, 7) };
}

function sourceLabel(status) {
  return status === "自动通过" ? "已核验事实" : "成员自述";
}

function line(value) {
  return String(value || "").trim();
}

function buildContent({ title, period, submissions, reviews, queue }) {
  const verified = reviews.filter((item) => item.status === "自动通过");
  const pending = queue.filter((item) => item.status === "待审核");
  const body = [`# ${title}`, `周期：${period.start} 至 ${period.end}`, "", "## 已核验事实"];
  if (verified.length) body.push(...verified.map((item) => `- ${line(item.summary)}`));
  else body.push("- 本周期暂无已核验事实。");
  body.push("", "## 成员自述");
  if (submissions.length) body.push(...submissions.map((item) => `- [${sourceLabel(item.reviewStatus)}] ${line(item.summary)}`));
  else body.push("- 本周期暂无问卷记录。");
  body.push("", "## 待负责人确认");
  if (pending.length) body.push(...pending.map((item) => `- ${line(item.question)}`));
  else body.push("- 无。");
  body.push("", "## 风险与支持需求");
  const needs = submissions.map((item) => line(item.support)).filter(Boolean);
  body.push(...(needs.length ? needs.map((item) => `- ${item}`) : ["- 无明确记录。"]))
  return body.join("\n");
}

export function buildMemberWeeklyReport(input) { return buildContent({ ...input, title: `${input.name} 成员周报` }); }
export function buildProjectWeeklyReport(input) { return buildContent({ ...input, title: `${input.name} 项目周报` }); }
export function buildStudioWeeklyReport(input) { return buildContent({ ...input, title: "工作室周报" }); }
export function buildMemberMonthlyReport(input) { return buildContent({ ...input, title: `${input.name} 成员月报` }); }
export function buildProjectMonthlyReport(input) { return buildContent({ ...input, title: `${input.name} 项目月报` }); }
export function buildStudioMonthlyReport(input) { return buildContent({ ...input, title: "工作室月报" }); }

function selectValue(value) { return Array.isArray(value) ? value[0] || "" : value || ""; }
function userId(value) { const item = Array.isArray(value) ? value[0] : value; return typeof item === "string" ? item : item?.id || ""; }
function userCell(openId) { return openId ? [{ id: openId }] : []; }
function nowText() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" }).format(new Date()); }

export class PeriodicReportService {
  constructor({ gateway, analyzer, config }) {
    this.gateway = gateway;
    this.analyzer = analyzer;
    this.config = config;
  }

  table(key, fallback) { return this.config.tables?.[key] || fallback; }

  dueTypes(now) {
    const local = localDateParts(now, this.config.periodicReports?.timezone || "Asia/Shanghai");
    const types = [];
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    if (weekday === 1 && local.hour >= Number(this.config.periodicReports?.weeklyHour ?? 8)) types.push("week");
    if (local.day === 1 && local.hour >= Number(this.config.periodicReports?.monthlyHour ?? 9)) types.push("month");
    return types;
  }

  loadPeriodData(period) {
    const weeklyRows = this.gateway.listRecords(this.table("weeklyGrowth", "成员周成长记录"), ["成员", "姓名", "所属项目", "周期开始", "周期结束", "本周具体工作&解决了什么问题", "本周可展示成果", "遇到的困难与需要的支持", "AI审核状态", "事实ID"]);
    const submissions = weeklyRows.filter((row) => String(row.fields?.["周期开始"] || "") <= period.end && String(row.fields?.["周期结束"] || "") >= period.start).map((row) => ({
      recordId: row.record_id, memberOpenId: userId(row.fields?.["成员"]), memberName: row.fields?.["姓名"] || "",
      projectName: row.fields?.["所属项目"] || "", reviewStatus: selectValue(row.fields?.["AI审核状态"]),
      summary: row.fields?.["本周具体工作&解决了什么问题"] || row.fields?.["本周可展示成果"] || "",
      support: row.fields?.["遇到的困难与需要的支持"] || "", factId: row.fields?.["事实ID"] || ""
    }));
    const reviewRows = this.gateway.listRecords(this.table("aiReviews", "Agent AI审核记录"), ["审核ID", "成员", "成员名称", "所属项目", "周期", "审核状态", "审核说明", "风险等级", "事实ID"]);
    const reviews = reviewRows.filter((row) => String(row.fields?.["周期"] || "").includes(period.start) || submissions.some((item) => item.factId && item.factId === row.fields?.["事实ID"])).map((row) => ({
      recordId: row.record_id, memberOpenId: userId(row.fields?.["成员"]), memberName: row.fields?.["成员名称"] || "",
      projectName: row.fields?.["所属项目"] || "", status: selectValue(row.fields?.["审核状态"]), summary: row.fields?.["审核说明"] || "",
      risk: selectValue(row.fields?.["风险等级"]), factId: row.fields?.["事实ID"] || ""
    }));
    const queue = filterQueueForCurrentReviews(this.gateway.listRecords(this.table("reviewQueue", "Agent 负责人审核队列"), ["事项ID", "成员", "成员名称", "所属项目", "审核状态", "待确认问题", "风险等级", "审核ID"]).map((row) => ({
      reviewId: row.fields?.["审核ID"] || "",
      memberOpenId: userId(row.fields?.["成员"]), memberName: row.fields?.["成员名称"] || "", projectName: row.fields?.["所属项目"] || "",
      status: selectValue(row.fields?.["审核状态"]), question: row.fields?.["待确认问题"] || "", risk: selectValue(row.fields?.["风险等级"])
    })), reviewRows.filter((row) => reviews.some((review) => review.recordId === row.record_id)).map((row) => row.fields?.["审核ID"]).filter(Boolean));
    return { submissions, reviews, queue };
  }

  reportExists(reportId) {
    return this.gateway.findByField(this.table("periodicReports", "Agent 周期报告"), "报告ID", reportId, ["报告ID", "报告状态", "AI审核说明"]);
  }

  async persistReport({ type, period, name, memberOpenId = "", projectName = "", content, sourceIds, risk = "低", refreshExisting = false }) {
    const reportId = stableId("report", [type, period.key, memberOpenId, projectName || name]);
    const existingReport = this.reportExists(reportId);
    if (existingReport && !refreshExisting) return { reportId, skipped: true };
    let finalContent = content;
    let narrative = null;
    let verification = null;
    let aiFailure = false;
    try {
      narrative = await this.analyzer.polishPeriodicReport({ type, period, deterministic_report: content });
      finalContent = `${content}\n\n## AI文字整理\n${narrative.summary}\n${narrative.highlights.map((item) => `- ${item}`).join("\n")}`;
      verification = await this.analyzer.verifyPeriodicReport({ type, period, deterministic_report: content, polished_report: finalContent });
    } catch {
      aiFailure = true;
      finalContent = `${content}\n\n> AI 整理或复核暂不可用，本报告已转负责人审核。`;
    }
    const alreadyEscalated = selectValue(existingReport?.fields?.["报告状态"]) === "待负责人审核";
    const escalated = alreadyEscalated || risk === "高" || aiFailure || shouldEscalatePeriodicVerification(verification);
    const reviewId = stableId("review", ["periodic-report", reportId]);
    if (escalated) {
      const reviewTable = this.table("aiReviews", "Agent AI审核记录");
      if (!this.gateway.findByField(reviewTable, "审核ID", reviewId, ["审核ID"])) this.gateway.createRecords(reviewTable, [{
        "审核ID": reviewId, "来源记录ID": reportId, "来源类型": "周期报告", "周期": period.key,
        "成员": userCell(memberOpenId), "成员名称": memberOpenId ? name : "", "所属项目": projectName,
        "事实ID": reportId, "候选内容": content, "第一层提取": JSON.stringify(narrative || {}), "第二层审核": JSON.stringify(verification || {}),
        "证据等级": "C", "风险等级": risk === "高" ? "高" : verification?.risk_level || "中", "审核状态": "人工审核",
        "需要人工审核": true, "允许正式写入": false, "审核说明": aiFailure ? "周期报告 AI 整理或复核失败" : verification?.rationale || "周期报告需要负责人审核",
        "审核模型": this.config.reviewModel || this.config.model, "重试次数": 0, "创建时间": nowText(), "完成时间": nowText(), "Agent版本": this.config.agentVersion
      }]);
      const queueTable = this.table("reviewQueue", "Agent 负责人审核队列");
      const itemId = `queue_${reviewId}`;
      if (!this.gateway.findByField(queueTable, "事项ID", itemId, ["事项ID"])) this.gateway.createRecords(queueTable, [{
        "事项ID": itemId, "审核ID": reviewId, "事项类型": "周期报告审核", "成员": userCell(memberOpenId), "成员名称": memberOpenId ? name : "",
        "所属项目": projectName, "风险等级": risk === "高" ? "高" : verification?.risk_level || "中", "事实摘要": `${type} ${period.start} 至 ${period.end}`,
        "待确认问题": aiFailure ? "AI 整理或复核失败，请核对确定性报告" : verification?.conflicts?.join("；") || "请确认周期报告",
        "AI建议": verification?.rationale || "保留确定性报告并人工确认", "审核负责人": userCell(this.config.weeklyReview?.ownerOpenId), "审核状态": "待审核",
        "已执行": false, "创建时间": nowText(), "Agent版本": this.config.agentVersion
      }]);
    }
    const reportFields = {
      "报告ID": reportId, "报告类型": type, "周期开始": period.start, "周期结束": period.end,
      "成员": userCell(memberOpenId), "成员名称": memberOpenId ? name : "", "所属项目": projectName,
      "报告状态": escalated ? "待负责人审核" : "AI已审核", "报告内容": finalContent,
      "来源记录ID": sourceIds.join(","), "风险等级": risk === "高" ? "高" : verification?.risk_level || risk,
      "AI审核说明": escalated ? (aiFailure ? "AI 整理或复核失败，已进入负责人队列" : verification?.rationale || "需负责人确认") : verification?.rationale || "独立复核通过",
      "审核负责人": escalated ? userCell(this.config.weeklyReview?.ownerOpenId) : [], "生成时间": nowText(), "Agent版本": this.config.agentVersion
    };
    if (existingReport?.record_id) this.gateway.updateRecords(this.table("periodicReports", "Agent 周期报告"), { [existingReport.record_id]: reportFields });
    else this.gateway.createRecords(this.table("periodicReports", "Agent 周期报告"), [reportFields]);
    return { reportId, skipped: false, refreshed: Boolean(existingReport) };
  }

  async generate(periodType, now = new Date(), { refreshExisting = false } = {}) {
    const period = periodKey(periodType, now, this.config.periodicReports?.timezone || "Asia/Shanghai");
    const data = this.loadPeriodData(period);
    if (!data.submissions.length && !data.reviews.length) return [];
    const suffix = periodType === "week" ? "周报" : "月报";
    const memberBuilder = periodType === "week" ? buildMemberWeeklyReport : buildMemberMonthlyReport;
    const projectBuilder = periodType === "week" ? buildProjectWeeklyReport : buildProjectMonthlyReport;
    const studioBuilder = periodType === "week" ? buildStudioWeeklyReport : buildStudioMonthlyReport;
    const results = [];
    const memberKeys = [...new Set(data.submissions.map((item) => item.memberOpenId || `name:${item.memberName}`).filter(Boolean))];
    for (const key of memberKeys) {
      const items = data.submissions.filter((item) => (item.memberOpenId || `name:${item.memberName}`) === key);
      const memberOpenId = key.startsWith("name:") ? "" : key;
      const name = items[0]?.memberName || memberOpenId;
      const subset = { period, name, submissions: items, reviews: data.reviews.filter((item) => item.memberOpenId === memberOpenId || item.memberName === name), queue: data.queue.filter((item) => item.memberOpenId === memberOpenId || item.memberName === name) };
      results.push(await this.persistReport({ type: `成员${suffix}`, period, name, memberOpenId, content: memberBuilder(subset), sourceIds: items.map((item) => item.recordId), risk: subset.queue.some((item) => item.risk === "高") ? "高" : "低", refreshExisting }));
    }
    const projects = [...new Set(data.submissions.map((item) => item.projectName).filter(Boolean))];
    for (const projectName of projects) {
      const items = data.submissions.filter((item) => item.projectName === projectName);
      const subset = { period, name: projectName, submissions: items, reviews: data.reviews.filter((item) => item.projectName === projectName), queue: data.queue.filter((item) => item.projectName === projectName) };
      results.push(await this.persistReport({ type: `项目${suffix}`, period, name: projectName, projectName, content: projectBuilder(subset), sourceIds: items.map((item) => item.recordId), risk: subset.queue.some((item) => item.risk === "高") ? "高" : "低", refreshExisting }));
    }
    results.push(await this.persistReport({ type: `工作室${suffix}`, period, name: "工作室", content: studioBuilder({ period, name: "工作室", ...data }), sourceIds: data.submissions.map((item) => item.recordId), risk: data.queue.some((item) => item.risk === "高") ? "高" : "低", refreshExisting }));
    return results;
  }

  async generateDueReports(now = new Date()) {
    if (this.config.periodicReports?.enabled === false) return [];
    const results = [];
    for (const type of this.dueTypes(now)) results.push(...await this.generate(type, now));
    return results;
  }
}
