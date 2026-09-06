import { buildRouteId } from "./fact-id.js";

export function normalizeAlias(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function routeRecord({ message, scopeType, project, basis, confidence, reviewStatus }) {
  const projectRecordId = project?.recordId || "";
  return {
    routeId: buildRouteId({ messageId: message.message_id, scopeType, projectId: projectRecordId }),
    messageId: message.message_id,
    senderOpenId: message.sender_id || "",
    scopeType,
    projectRecordId,
    projectName: project?.name || "",
    basis,
    confidence,
    reviewStatus,
    candidateAlias: ""
  };
}

export class ProjectRouter {
  constructor({ projects, operationsProjectName }) {
    this.projects = projects || [];
    this.operationsProject = this.projects.find((project) => project.name === operationsProjectName) || null;
    this.aliases = this.projects.flatMap((project) => [project.name, ...(project.aliases || [])]
      .map((alias) => ({ project, alias, normalized: normalizeAlias(alias) })))
      .filter((item) => item.normalized);
  }

  matchingProjects(content) {
    const normalized = normalizeAlias(content);
    const matches = [];
    for (const item of this.aliases) {
      if (!normalized.includes(item.normalized)) continue;
      if (!matches.some((project) => project.recordId === item.project.recordId)) matches.push(item.project);
    }
    return matches;
  }

  routeRound({ mapping, messages }) {
    const routes = [];
    const resolvedByMessageId = new Map();
    const remember = (message, messageRoutes) => {
      if (message?.message_id) resolvedByMessageId.set(message.message_id, messageRoutes);
      routes.push(...messageRoutes);
    };
    for (const message of messages || []) {
      if (mapping.chatType === "项目专属" && mapping.projectRecordId) {
        const project = this.projects.find((item) => item.recordId === mapping.projectRecordId) || {
          recordId: mapping.projectRecordId,
          name: mapping.projectName || ""
        };
        remember(message, [routeRecord({
          message,
          scopeType: "项目",
          project,
          basis: "群绑定",
          confidence: 1,
          reviewStatus: "自动确认"
        })]);
        continue;
      }

      if (/【(?:工作室运营|跨项目事项)】/.test(String(message.content || ""))) {
        remember(message, [routeRecord({
          message,
          scopeType: "工作室运营",
          project: this.operationsProject,
          basis: "汇报模板",
          confidence: 1,
          reviewStatus: "自动确认"
        })]);
        continue;
      }

      const matches = this.matchingProjects(message.content)
        .filter((project) => project.recordId !== this.operationsProject?.recordId);
      if (matches.length) {
        const matchedRoutes = [];
        for (const project of matches) {
          matchedRoutes.push(routeRecord({
            message,
            scopeType: "项目",
            project,
            basis: /【项目】/.test(String(message.content || "")) ? "汇报模板" : "确认别名",
            confidence: 1,
            reviewStatus: "自动确认"
          }));
        }
        remember(message, matchedRoutes);
        continue;
      }

      const replyMessageId = message.reply_to || message.parent_id || "";
      const inheritedRoutes = resolvedByMessageId.get(replyMessageId) || [];
      if (inheritedRoutes.length === 1 && inheritedRoutes[0].projectRecordId) {
        const inherited = inheritedRoutes[0];
        const project = this.projects.find((item) => item.recordId === inherited.projectRecordId) || {
          recordId: inherited.projectRecordId,
          name: inherited.projectName
        };
        remember(message, [routeRecord({
          message,
          scopeType: inherited.scopeType,
          project,
          basis: "回复继承",
          confidence: 1,
          reviewStatus: "自动确认"
        })]);
        continue;
      }

      remember(message, [routeRecord({
        message,
        scopeType: "无法确认",
        project: null,
        basis: "AI判断",
        confidence: 0,
        reviewStatus: "待确认"
      })]);
    }
    return routes;
  }
}

export function mergeAiRouteSuggestions(existingRoutes, suggestions) {
  const merged = [...(existingRoutes || [])];
  for (const suggestion of suggestions || []) {
    merged.push({
      routeId: buildRouteId({
        messageId: suggestion.messageId,
        scopeType: suggestion.scopeType,
        projectId: suggestion.projectRecordId || ""
      }),
      ...suggestion,
      reviewStatus: "待确认"
    });
  }
  return merged;
}

export function selectReviewerOpenIds(members) {
  return [...new Set((members || [])
    .filter((member) => member.stage === "负责人" && !["暂休", "已退出"].includes(member.status))
    .map((member) => member.openId)
    .filter(Boolean))];
}

export function duplicateUnresolvedRouteIds(routes) {
  const groups = new Map();
  for (const route of routes || []) {
    if (route.reviewStatus !== "待确认" || route.projectName) continue;
    const list = groups.get(route.messageId) || [];
    list.push(route);
    groups.set(route.messageId, list);
  }
  const duplicates = [];
  for (const routesForMessage of groups.values()) {
    const hasBasePending = routesForMessage.some((route) => route.basis === "AI判断");
    if (!hasBasePending) continue;
    for (const route of routesForMessage) {
      if (String(route.basis || "").startsWith("AI语义建议")) duplicates.push(route.routeId);
    }
  }
  return duplicates;
}

export function invalidSemanticRouteIds(routes, validMessageIds) {
  return (routes || [])
    .filter((route) => String(route.basis || "").startsWith("AI语义建议"))
    .filter((route) => !validMessageIds.has(route.messageId))
    .map((route) => route.routeId);
}

export function reviewStatusForMode(reviewStatus, routeMode) {
  if (routeMode === "影子" && reviewStatus === "自动确认") return "待确认";
  return reviewStatus;
}
