import { buildReviewId, extractUrls, stableId } from "./review-policy.js";

const TEXT_FIELDS = [
  "本周具体工作&解决了什么问题",
  "我解决了什么问题",
  "本周可展示成果",
  "AI协作过程",
  "遇到的困难与需要的支持",
  "主动同步或协作了什么",
  "本周最满意&最不满意的一点",
  "当前项目或学习主题"
];

export function fieldsFromRecord(record) {
  return record?.fields || record?.record?.fields || {};
}

export function recordIdFrom(record) {
  return record?.record_id || record?.recordId || record?.id || "";
}

function selectValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function userIds(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map((item) => typeof item === "string" ? item : item?.id || item?.open_id).filter(Boolean);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s·•._-]+/g, "");
}

function parseFeishuDate(value) {
  if (!value) return new Date();
  if (typeof value === "number") return new Date(value > 1e12 ? value : value * 1000);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) return new Date(`${text.replace(" ", "T")}+08:00`);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function shanghaiWeekBounds(value) {
  const date = parseFeishuDate(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const localMidnight = Date.UTC(get("year"), get("month") - 1, get("day"));
  const weekday = new Date(localMidnight).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const start = new Date(localMidnight - mondayOffset * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  const ymd = (item) => item.toISOString().slice(0, 10);
  return { start: ymd(start), end: ymd(end), key: `${ymd(start)}_${ymd(end)}` };
}

function memberCandidates(directory) {
  if (directory instanceof Map) return [...directory.entries()].map(([openId, item]) => ({ openId, ...item }));
  return Array.isArray(directory) ? directory : [];
}

function resolveMember(fields, directory) {
  const explicitId = userIds(fields["成员"])[0];
  const name = String(fields["姓名"] || "").trim();
  const candidates = memberCandidates(directory);
  if (explicitId) {
    const found = candidates.find((item) => item.openId === explicitId);
    return { openId: explicitId, name: found?.name || name, recordId: found?.recordId || "" };
  }
  const matches = candidates.filter((item) => normalizeName(item.name) === normalizeName(name));
  if (matches.length === 1) return { openId: matches[0].openId, name: matches[0].name || name, recordId: matches[0].recordId || "" };
  return { openId: "", name, recordId: "" };
}

function projectCandidates(catalog) {
  return (Array.isArray(catalog) ? catalog : []).flatMap((project) => {
    const aliases = Array.isArray(project.aliases)
      ? project.aliases
      : String(project.aliases || project.alias || "").split(/[，,、;；\n]/).filter(Boolean);
    return [project.name, ...aliases].filter(Boolean).map((alias) => ({ alias, project }));
  });
}

function resolveProject(topic, catalog) {
  const text = normalizeName(topic);
  if (!text) return { name: "", recordId: "", candidate: "" };
  const matches = projectCandidates(catalog).filter(({ alias }) => text.includes(normalizeName(alias)) || normalizeName(alias).includes(text));
  const projects = [...new Map(matches.map(({ project }) => [project.name, project])).values()];
  if (projects.length === 1) return { name: projects[0].name, recordId: projects[0].recordId || "", candidate: topic };
  return { name: "", recordId: "", candidate: topic };
}

export function reportingWeekBounds(value, submissionGraceDays = 1) {
  const text = String(value || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)
    ? new Date(`${text.replace(" ", "T")}+08:00`)
    : new Date(value);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(date);
  const weekdayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  const graceDays = Math.max(0, Math.min(6, Number(submissionGraceDays) || 0));
  const reportingDate = weekdayIndex >= 0 && weekdayIndex < graceDays
    ? new Date(date.getTime() - 7 * 86400000)
    : date;
  return shanghaiWeekBounds(reportingDate);
}

export function normalizeWeeklySubmission(record, { members = [], projects = [], submissionGraceDays = 1 } = {}) {
  const fields = fieldsFromRecord(record);
  const recordId = recordIdFrom(record);
  const submittedAt = fields["提交时间"] || fields["创建时间"] || new Date().toISOString();
  const period = reportingWeekBounds(submittedAt, submissionGraceDays);
  const member = resolveMember(fields, members);
  const topic = String(fields["当前项目或学习主题"] || "").trim();
  const project = resolveProject(topic, projects);
  const answers = Object.fromEntries(TEXT_FIELDS.map((name) => [name, String(fields[name] || "").trim()]));
  const summaryText = TEXT_FIELDS.map((name) => answers[name]).filter(Boolean).join("\n");
  const links = extractUrls(summaryText);
  const factId = stableId("fact", [member.openId || member.name, project.name || topic, period.key, summaryText]);
  return {
    recordId,
    reviewId: buildReviewId(recordId, period.key),
    factId,
    memberOpenId: member.openId,
    memberName: member.name,
    memberRecordId: member.recordId,
    projectName: project.name,
    projectRecordId: project.recordId,
    projectCandidate: project.candidate,
    weekKey: period.key,
    periodStart: period.start,
    periodEnd: period.end,
    submittedAt,
    weekLabel: selectValue(fields["周次"]),
    goals: Array.isArray(fields["本周目标完成情况"]) ? fields["本周目标完成情况"] : [],
    answers,
    summaryText,
    links,
    attachmentCount: Array.isArray(fields["成果附件"]) ? fields["成果附件"].length : 0,
    independentSources: 0,
    ownerConfirmed: selectValue(fields["反馈状态"]) === "已反馈",
    connectorOpenIds: userIds(fields["对接人"]),
    rawFields: fields
  };
}

export function buildWeeklyReviewPayload(candidate, relatedEvidence = []) {
  return {
    source: "成员周成长记录",
    record_id: candidate.recordId,
    review_id: candidate.reviewId,
    fact_id: candidate.factId,
    period: { start: candidate.periodStart, end: candidate.periodEnd, key: candidate.weekKey },
    member: { open_id: candidate.memberOpenId, name: candidate.memberName },
    project: { confirmed_name: candidate.projectName, submitted_topic: candidate.projectCandidate },
    goals: candidate.goals,
    answers: candidate.answers,
    artifact_links: candidate.links,
    attachment_count: candidate.attachmentCount,
    related_evidence: relatedEvidence
  };
}
