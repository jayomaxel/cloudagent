import { loadConfig } from "../src/config.js";
import { buildWeeklyReviewPayload, normalizeWeeklySubmission } from "../src/weekly-questionnaire.js";
import { createStandaloneReviewServices } from "../src/weekly-review-runtime.js";
import { buildReviewId, stableId } from "../src/review-policy.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const apply = process.argv.includes("--apply");
const refreshReports = process.argv.includes("--refresh-reports");
const forcedMembers = new Set(arg("--members").split(/[，,]/).map((name) => name.trim()).filter(Boolean));
const forcedRecordIds = new Set(arg("--record-ids").split(/[，,]/).map((id) => id.trim()).filter(Boolean));
const forcedStart = arg("--force-start");
const forcedEnd = arg("--force-end");
const hasForcedPeriod = forcedMembers.size > 0 || forcedRecordIds.size > 0 || forcedStart || forcedEnd;
if (hasForcedPeriod && (!(forcedMembers.size || forcedRecordIds.size) || !/^\d{4}-\d{2}-\d{2}$/.test(forcedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(forcedEnd))) {
  throw new Error("显式周期覆盖需要同时提供 --record-ids（推荐）或 --members，以及 --force-start YYYY-MM-DD 和 --force-end YYYY-MM-DD");
}
const config = loadConfig();
const { gateway, workflow, reports } = createStandaloneReviewServices(config);
const fields = [
  "姓名", "成员", "周次", "本周目标完成情况", "本周具体工作&解决了什么问题", "我解决了什么问题",
  "本周可展示成果", "成果附件", "AI协作过程", "遇到的困难与需要的支持", "主动同步或协作了什么",
  "本周最满意&最不满意的一点", "当前项目或学习主题", "提交时间", "反馈状态", "对接人",
  "周期开始", "周期结束", "事实ID", "所属项目", "AI审核状态"
];
const members = workflow.loadMembers();
const projects = workflow.loadProjects();
const rows = gateway.listRecords(config.tables.weeklyGrowth, fields);
const corrections = [];

for (const row of rows) {
  const candidate = normalizeWeeklySubmission(row, {
    members,
    projects,
    submissionGraceDays: config.weeklyReview?.submissionGraceDays ?? 1,
  });
  const forceThisRecord = forcedRecordIds.size
    ? forcedRecordIds.has(candidate.recordId)
    : forcedMembers.has(candidate.memberName);
  if (hasForcedPeriod && !forceThisRecord) continue;
  if (forceThisRecord) {
    candidate.periodStart = forcedStart;
    candidate.periodEnd = forcedEnd;
    candidate.weekKey = `${forcedStart}_${forcedEnd}`;
    candidate.reviewId = buildReviewId(candidate.recordId, candidate.weekKey);
    candidate.factId = stableId("fact", [
      candidate.memberOpenId || candidate.memberName,
      candidate.projectName || candidate.projectCandidate,
      candidate.weekKey,
      candidate.summaryText,
    ]);
  }
  const storedStart = String(row.fields?.["周期开始"] || "").slice(0, 10);
  const storedEnd = String(row.fields?.["周期结束"] || "").slice(0, 10);
  if (storedStart === candidate.periodStart && storedEnd === candidate.periodEnd) continue;
  const review = gateway.findByField(config.tables.aiReviews, "来源记录ID", candidate.recordId, ["来源记录ID", "审核ID"]);
  const oldReviewId = String(review?.fields?.["审核ID"] || "");
  const queue = oldReviewId ? gateway.findByField(config.tables.reviewQueue, "审核ID", oldReviewId, ["审核ID", "事项ID"]) : null;
  corrections.push({ row, candidate, review, queue, oldReviewId, storedStart, storedEnd });
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  corrections: corrections.map(({ candidate, oldReviewId, storedStart, storedEnd }) => ({
    recordId: candidate.recordId,
    member: candidate.memberName,
    from: `${storedStart}_${storedEnd}`,
    to: candidate.weekKey,
    oldReviewId,
    newReviewId: candidate.reviewId,
  })),
}, null, 2));

if (apply) {
  for (const { candidate, review, queue } of corrections) {
    gateway.updateRecords(config.tables.weeklyGrowth, { [candidate.recordId]: {
      "周期开始": candidate.periodStart,
      "周期结束": candidate.periodEnd,
      "所属项目": candidate.projectName || candidate.projectCandidate,
      "事实ID": candidate.factId,
    } });
    if (review?.record_id) gateway.updateRecords(config.tables.aiReviews, { [review.record_id]: {
      "审核ID": candidate.reviewId,
      "周期": candidate.weekKey,
      "所属项目": candidate.projectName || candidate.projectCandidate,
      "事实ID": candidate.factId,
      "候选内容": JSON.stringify(buildWeeklyReviewPayload(candidate)),
    } });
    if (queue?.record_id) gateway.updateRecords(config.tables.reviewQueue, { [queue.record_id]: {
      "事项ID": `queue_${candidate.reviewId}`,
      "审核ID": candidate.reviewId,
      "所属项目": candidate.projectName || candidate.projectCandidate,
    } });
  }
  const reportResults = (corrections.length || refreshReports)
    ? await reports.generate("week", new Date(), { refreshExisting: true })
    : [];
  console.log(JSON.stringify({ migrated: corrections.length, reports: reportResults }, null, 2));
}
