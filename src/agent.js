import { Analyzer } from "./analyzer.js";
import fs from "node:fs";
import path from "node:path";

function recordsFrom(output) {
  const payload = output.data || {};
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.fields) && Array.isArray(payload.data)) {
    return payload.data.map((row, rowIndex) => ({
      record_id: payload.record_id_list?.[rowIndex],
      fields: Object.fromEntries(payload.fields.map((field, index) => [field, row[index]]))
    }));
  }
  return [];
}

function fieldsFrom(record) {
  return record.fields || record.data || record;
}

function recordIdFrom(record) {
  return record.record_id || record.id || "";
}

function chatDisplayNameFrom(output) {
  const payload = output?.data?.chat || output?.data || output || {};
  return String(payload.name || payload.chat_name || "").trim();
}

function openIdFromCell(value) {
  return openIdsFromCell(value)[0] || "";
}

function openIdsFromCell(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const ids = [];
  for (const item of values) {
    if (typeof item === "string" && item.startsWith("ou_")) {
      ids.push(item);
      continue;
    }
    const id = item?.id || item?.open_id || item?.user_id;
    if (typeof id === "string" && id.startsWith("ou_")) ids.push(id);
  }
  return [...new Set(ids)];
}

function selectValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function toFeishuDate(value = Date.now()) {
  const raw = String(value);
  const numeric = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 100000000000 ? numeric * 1000 : numeric)
    : new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function userCell(openId) {
  return openId && openId.startsWith("ou_") ? [{ id: openId }] : null;
}

function compactIds(ids) {
  return [...new Set(ids || [])].join(",").slice(0, 1800);
}

function membershipKey(projectName, openId) {
  return `${String(projectName || "").trim()}::${openId}`;
}

function messageTimeMs(message) {
  const raw = String(message?.create_time || Date.now());
  const numeric = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (Number.isFinite(numeric)) return numeric < 100000000000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

const DEFAULT_NOTIFICATION_PREFIXES = ["【通知】", "【安排】", "【任务】", "#通知", "#安排", "#任务"];

function notificationPrefixes(config) {
  const configured = config.notifications?.triggerPrefixes;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_NOTIFICATION_PREFIXES;
}

function startsWithNotificationPrefix(content, config) {
  const text = String(content || "").trimStart();
  return notificationPrefixes(config).some((prefix) => text.startsWith(prefix));
}

function stripNotificationPrefix(content, config) {
  let text = String(content || "").trimStart();
  for (const prefix of notificationPrefixes(config)) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length).trimStart();
      break;
    }
  }
  return text;
}

function minutesBetween(start, end) {
  return Math.max(0, Math.round(((end || Date.now()) - (start || Date.now())) / 60000));
}

function conversationIdleMs(config) {
  return Math.max(Number(config.batch?.idleSeconds) || 1800, 1) * 1000;
}

function splitConversationRounds(messages, idleMs) {
  const rounds = [];
  let current = [];
  let lastTime = 0;
  for (const message of messages) {
    const time = messageTimeMs(message);
    if (current.length && time - lastTime > idleMs) {
      rounds.push(current);
      current = [];
    }
    current.push(message);
    lastTime = time;
  }
  if (current.length) rounds.push(current);
  return rounds;
}

function compactText(value, max = 1800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function firstRecordIdFromCreate(output) {
  const outputs = Array.isArray(output) ? output : [output];
  for (const item of outputs) {
    const ids = item?.data?.record_id_list || item?.record_id_list || [];
    if (ids[0]) return ids[0];
  }
  return "";
}

function messageIdFromSend(output) {
  const payload = output?.data || output || {};
  return payload.message_id || payload.message?.message_id || payload.message?.id || payload.id || "";
}

function noticeId(chatId, sourceMessageIds) {
  const first = sourceMessageIds[0] || "unknown";
  const last = sourceMessageIds[sourceMessageIds.length - 1] || first;
  return `${chatId}:${first}:${last}`.slice(0, 240);
}

function markdownList(items) {
  return (items || [])
    .filter(Boolean)
    .slice(0, 6)
    .map((item) => `- ${String(item).trim()}`)
    .join("\n");
}

function listText(items, max = 8) {
  return (items || [])
    .filter(Boolean)
    .slice(0, max)
    .map((item) => `- ${String(item).trim()}`)
    .join("\n");
}

function topicSnapshotId(chatId, sourceMessageIds, title) {
  const ids = sourceMessageIds || [];
  const first = ids[0] || "unknown";
  const last = ids[ids.length - 1] || first;
  return `${chatId}:${first}:${last}:${title || "topic"}`.slice(0, 240);
}

function labelValue(text, label) {
  const match = String(text || "").match(new RegExp(`【${label}】\\s*([^\\n]+)`));
  return match?.[1]?.trim() || "";
}

function eventMemberUsers(event) {
  const payload = event?.event || event || {};
  return (payload.users || []).map((user) => ({
    id: user?.user_id?.open_id || user?.open_id || "",
    name: user?.name || ""
  })).filter((user) => user.id.startsWith("ou_"));
}

function hasExplicitTimezone(value) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(String(value || "").trim());
}

import { buildBatchId, buildFactId, buildRouteId, contentFingerprint } from "./fact-id.js";
import { PendingBatchStore, isBatchAlreadyProcessed, isMessageAvailableForAnalysis, remainingRetryDelayMs, retryDelayMs, runReliableOperation, shouldReconcileBatchState } from "./reliability.js";
import { clearRuntimeHandles, runOptionalStartupStep } from "./lifecycle.js";
import { ProjectRouter, duplicateUnresolvedRouteIds, invalidSemanticRouteIds, reviewStatusForMode, selectReviewerOpenIds } from "./router.js";
import { sanitizeMessages } from "./security.js";
import { SemanticRoutingAnalyzer, safeSemanticSuggestions } from "./routing-analyzer.js";
import { buildReviewerDigests, parseReviewerIds } from "./review-digest.js";
import { calculateShadowAudit } from "./shadow-audit.js";
import {
  formatShadowAuditNotification,
  loadShadowAcceptanceState,
  markShadowAuditReviewerNotified,
  pendingShadowAuditReviewers,
  saveShadowAcceptanceState
} from "./shadow-monitor.js";
import { estimateModelCost, normalizeModelUsage, runtimeStatus } from "./health-status.js";
import {
  canLinkEvaluationToMember,
  claimReviewStatus,
  deriveEvidence,
  eligibleConfirmedFacts,
  normalizeClaimLevel,
  validateWorkStyleObservation
} from "./evidence-governance.js";

export class StudioAgent {
  constructor(config, lark) {
    this.config = config;
    this.lark = lark;
    this.runtimeStartedAt = Date.now();
    this.lastMessageAt = 0;
    this.lastAnalysisAt = 0;
    this.lastWeeklyReportAt = 0;
    this.lastMonthlyReportAt = 0;
    this.lastRuntimeError = "";
    this.lastRuntimeErrorAt = 0;
    this.modelHealth = "未知";
    this.modelUsageTotals = { calls: 0, tokens: 0, cost: 0 };
    this.runtimeEventSequence = 0;
    this.groupHealth = new Map();
    this.workStyleStateFile = path.resolve(config.root, ".data/work-style-evaluation-state.json");
    try {
      this.workStyleState = JSON.parse(fs.readFileSync(this.workStyleStateFile, "utf8"));
    } catch {
      this.workStyleState = {};
    }
    this.analyzer = new Analyzer(config, { onTelemetry: (event) => this.recordModelTelemetry(event) });
    this.chatMappings = new Map();
    this.memberDirectory = new Map();
    this.projectMemberships = new Map();
    this.batches = new Map();
    this.processedFile = path.resolve(
      config.root,
      config.history?.stateFile || ".data/processed-message-ids.json"
    );
    this.processed = this.loadProcessedIds();
    this.inFlight = new Set();
    this.pendingBatchStore = new PendingBatchStore(path.resolve(
      config.root,
      config.reliability?.spoolDirectory || ".data/pending-batches"
    ));
    this.shadowAcceptanceStateFile = path.resolve(config.root, ".data/shadow-acceptance-state.json");
    this.shadowAcceptanceState = loadShadowAcceptanceState(this.shadowAcceptanceStateFile);
    this.retryTimers = new Map();
    this.projectCatalog = [];
    this.projectRouter = new ProjectRouter({
      projects: [],
      operationsProjectName: config.routing?.operationsProjectName || "工作室运营 / 多项目混合"
    });
    this.semanticRoutingAnalyzer = new SemanticRoutingAnalyzer({
      apiKey: config.aiApiKey || process.env.DEEPSEEK_API_KEY,
      baseUrl: config.aiBaseUrl,
      model: config.routing?.semanticModel || config.model || "deepseek-chat",
      timeoutMs: Math.max(Number(config.reliability?.modelTimeoutSeconds) || 60, 5) * 1000
    });
    this.autoEnrollInFlight = new Map();
    this.chatMetadataRetryAt = new Map();
    this.activeNotifications = new Map();
    this.notificationIdleTimers = new Map();
    this.trackedNotifications = new Map();
    this.recentMessagesById = new Map();
    this.lastDiscussionByChat = new Map();
    this.memberRosterByChat = new Map();
    this.reminderStateFile = path.resolve(config.root, ".data/agent-reminder-state.json");
    this.reminderState = this.loadReminderState();
    this.stream = null;
    this.timers = [];
  }

  loadReminderState() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.reminderStateFile, "utf8"));
      return {
        notification: payload.notification || {},
        profile: payload.profile || {}
      };
    } catch {
      return { notification: {}, profile: {} };
    }
  }

  saveReminderState() {
    fs.mkdirSync(path.dirname(this.reminderStateFile), { recursive: true });
    const temporaryPath = `${this.reminderStateFile}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.reminderState, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.reminderStateFile);
  }

  loadProcessedIds() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.processedFile, "utf8"));
      return new Set(Array.isArray(payload.message_ids) ? payload.message_ids : []);
    } catch {
      return new Set();
    }
  }

  saveProcessedIds() {
    fs.mkdirSync(path.dirname(this.processedFile), { recursive: true });
    const temporaryPath = `${this.processedFile}.tmp`;
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify({ updated_at: new Date().toISOString(), message_ids: [...this.processed] }, null, 2),
      "utf8"
    );
    fs.renameSync(temporaryPath, this.processedFile);
  }

  isExcludedChat(chatId) {
    return new Set(this.config.privacy.excludedChatIds || []).has(chatId);
  }

  async refreshChatMappings() {
    const output = this.lark.listRecords(this.config.tables.chatConfig, [
      "群聊ID", "群聊名称", "所属项目", "启用分析", "允许文档草稿"
    ]);
    const mappings = new Map();
    for (const record of recordsFrom(output)) {
      const fields = fieldsFrom(record);
      if (!fields["启用分析"] || !fields["群聊ID"] || this.isExcludedChat(fields["群聊ID"])) continue;
      const chatId = fields["群聊ID"];
      let chatName = fields["群聊名称"] || chatId;
      const retryAt = Number(this.chatMetadataRetryAt.get(chatId) || 0);
      if (chatName === chatId && Date.now() >= retryAt) {
        try {
          const resolvedName = chatDisplayNameFrom(this.lark.getChat(chatId));
          if (resolvedName && resolvedName !== chatId) {
            chatName = resolvedName;
            const recordId = recordIdFrom(record);
            if (recordId) {
              this.lark.updateRecords(this.config.tables.chatConfig, {
                [recordId]: {
                  "配置名称": `${resolvedName}｜自动接入`,
                  "群聊名称": resolvedName,
                  "最近同步": toFeishuDate()
                }
              });
            }
            this.chatMetadataRetryAt.delete(chatId);
            console.log(`[agent] 已补全自动接入群名称：${resolvedName}`);
          }
        } catch (error) {
          const retryMinutes = Math.max(Number(this.config.autoEnroll?.metadataRetryMinutes) || 30, 5);
          this.chatMetadataRetryAt.set(chatId, Date.now() + retryMinutes * 60 * 1000);
          console.warn(`[agent] 暂时无法补全群聊名称 ${chatId}，将在 ${retryMinutes} 分钟后重试：${error.message}`);
        }
      }
      mappings.set(chatId, {
        chatId,
        chatName,
        projectName: fields["所属项目"] || "待归属项目",
        allowDocumentDrafts: Boolean(fields["允许文档草稿"])
      });
    }
    this.chatMappings = mappings;
    console.log(`[agent] 已加载 ${mappings.size} 个启用的项目群`);
  }

  async refreshIdentityMappings() {
    const [memberOutput, membershipOutput] = await Promise.all([
      this.lark.listRecords(this.config.tables.members, [
        "飞书成员", "姓名", "成长阶段", "成员状态", "年级", "兴趣方向", "技能标签", "加入日期"
      ]),
      this.lark.listRecords(this.config.tables.projectMemberships, [
        "所属项目", "成员", "项目角色", "成员类型", "关系状态", "加入日期", "退出日期"
      ])
    ]);

    const members = new Map();
    for (const record of recordsFrom(memberOutput)) {
      const fields = fieldsFrom(record);
      const openId = openIdFromCell(fields["飞书成员"]);
      if (!openId) continue;
      members.set(openId, {
        recordId: recordIdFrom(record),
        openId,
        name: fields["姓名"] || "",
        stage: selectValue(fields["成长阶段"]),
        status: selectValue(fields["成员状态"]),
        grade: selectValue(fields["年级"]),
        interests: Array.isArray(fields["兴趣方向"]) ? fields["兴趣方向"] : [],
        skills: String(fields["技能标签"] || ""),
        joinedAt: fields["加入日期"] || ""
      });
    }

    const memberships = new Map();
    for (const record of recordsFrom(membershipOutput)) {
      const fields = fieldsFrom(record);
      const openIds = openIdsFromCell(fields["成员"]);
      const projectName = String(fields["所属项目"] || "").trim();
      if (!openIds.length || !projectName) continue;
      for (const openId of openIds) {
        const item = {
          recordId: recordIdFrom(record),
          openId,
          projectName,
          role: selectValue(fields["项目角色"]),
          memberType: selectValue(fields["成员类型"]) || "工作室成员",
          status: selectValue(fields["关系状态"]) || "待确认",
          joinedAt: fields["加入日期"] || "",
          exitedAt: fields["退出日期"] || ""
        };
        const key = membershipKey(projectName, openId);
        const current = memberships.get(key);
        if (!current || item.status === "活跃") memberships.set(key, item);
      }
    }

    this.memberDirectory = members;
    this.projectMemberships = memberships;
    console.log(`[agent] 已加载 ${members.size} 名工作室成员、${memberships.size} 条项目成员关系`);
  }

  resolveIdentity(openId, projectName) {
    const member = this.memberDirectory.get(openId);
    const membership = this.projectMemberships.get(membershipKey(projectName, openId));

    if (membership?.memberType === "指导教师") {
      return this.identityResult("指导教师", "项目关系标记为指导教师，不进入学生成员总结。", member, membership, true);
    }
    if (membership?.memberType === "外部协作者") {
      return this.identityResult("外部协作者", "项目关系标记为外部协作者，需要人工确认贡献用途。", member, membership, true);
    }
    if (membership?.memberType === "临时参与者") {
      return this.identityResult("临时参与者", "项目关系标记为临时参与者，不自动成为工作室成员。", member, membership, true);
    }
    if (!member) {
      return this.identityResult("身份待确认", "发送者不在成员档案中，Agent 不猜测其姓名或身份。", null, membership, true);
    }
    if (member.grade === "指导教师") {
      return this.identityResult("指导教师", "成员档案标记为指导教师，不进入学生成员总结。", member, membership, true);
    }
    if (member.status === "已退出") {
      return this.identityResult("已退出成员", "成员档案状态为已退出，仅保留历史事实。", member, membership, true);
    }
    if (member.status === "暂休") {
      return this.identityResult("暂休成员", "成员档案状态为暂休，需要人工确认当前项目参与情况。", member, membership, true);
    }
    if (membership?.status === "活跃") {
      return this.identityResult("已匹配项目成员", `已匹配项目成员关系，角色：${membership.role || "未填写"}。`, member, membership, false);
    }
    if (member.stage === "负责人") {
      return this.identityResult("已匹配项目成员", "成员档案标记为负责人，作为工作室负责人可跨项目计入。", member, membership, false);
    }
    return this.identityResult(
      "工作室成员·非项目成员",
      membership
        ? `工作室成员已登记，但项目关系状态为“${membership.status}”。`
        : "工作室成员已登记，但没有当前项目的有效成员关系。",
      member,
      membership,
      true
    );
  }

  identityResult(status, note, member, membership, requiresReview) {
    return {
      status,
      note,
      memberRecordId: member?.recordId || "",
      membershipRecordId: membership?.recordId || "",
      requiresReview
    };
  }

  buildIdentityContext(projectName, messages) {
    const senderIds = [...new Set(messages.map((message) => message.sender_id).filter(Boolean))];
    return {
      source_of_truth: "成员档案 + 项目成员关系",
      message_senders: senderIds.map((openId) => ({
        open_id: openId,
        ...this.resolveIdentity(openId, projectName)
      })),
      active_project_members: [...this.projectMemberships.values()]
        .filter((item) => item.projectName === projectName && item.status === "活跃")
        .map((item) => ({
          open_id: item.openId,
          role: item.role,
          member_type: item.memberType
        }))
    };
  }

  findChatConfig(chatId) {
    const output = this.lark.listRecords(this.config.tables.chatConfig, [
      "群聊ID", "群聊名称", "所属项目", "启用分析", "允许文档草稿"
    ]);
    return recordsFrom(output)
      .map((record) => fieldsFrom(record))
      .find((fields) => fields["群聊ID"] === chatId) || null;
  }

  async ensureAutoChatConfig(chatId, chatName = "") {
    if (!chatId || this.isExcludedChat(chatId) || !this.config.autoEnroll?.enabled) return false;
    if (this.chatMappings.has(chatId)) return true;
    if (this.autoEnrollInFlight.has(chatId)) return this.autoEnrollInFlight.get(chatId);

    const task = (async () => {
      const existing = this.findChatConfig(chatId);
      if (!existing) {
        const resolvedName = chatName || chatId;
        this.lark.createRecords(this.config.tables.chatConfig, [{
          "配置名称": `${resolvedName}｜自动接入`,
          "群聊ID": chatId,
          "群聊名称": resolvedName,
          "所属项目": this.config.autoEnroll.defaultProjectName || "待归属项目",
          "启用分析": true,
          "允许文档草稿": Boolean(this.config.autoEnroll.allowDocumentDrafts),
          "数据保留天数": this.config.privacy.retentionDays,
          "说明": "机器人入群自动创建；所属项目待人工确认，文档默认只保留审核草稿。",
          "最近同步": toFeishuDate()
        }]);
      }
      await this.refreshChatMappings();
      return this.chatMappings.has(chatId);
    })();
    this.autoEnrollInFlight.set(chatId, task);
    try {
      return await task;
    } finally {
      this.autoEnrollInFlight.delete(chatId);
    }
  }

  async handleBotAdded(event) {
    const payload = event.event || event;
    if (!payload.chat_id) return;
    await this.ensureAutoChatConfig(payload.chat_id, payload.name || payload.chat_id);
    console.log(`[agent] 机器人已加入群聊，自动启用分析：${payload.name || payload.chat_id}`);
  }

  managedGroup(chatId) {
    return (this.config.memberGovernance?.groups || []).find((group) => group.chatId === chatId) || null;
  }

  memberProfileIncomplete(member) {
    return Boolean(member && (!member.grade || !member.interests?.length || !member.skills));
  }

  async sendProfileReminder(openId, name = "同学") {
    const settings = this.config.memberGovernance || {};
    if (!settings.memberProfileFormUrl) return false;
    const repeatMs = Math.max(Number(settings.profileReminderRepeatDays) || 7, 1) * 24 * 60 * 60 * 1000;
    const lastSent = Number(this.reminderState.profile[openId] || 0);
    if (Date.now() - lastSent < repeatMs) return false;
    this.lark.sendPrivateText(
      openId,
      `${name}你好，我是云机器人。为了让项目成员、贡献记录和后续协作能正确对应，请补全工作室成员档案：${settings.memberProfileFormUrl}\n\n这是资料补全提醒，不是考核通知；如信息已经完整，可以忽略。`,
      `profile-${openId.slice(-16)}-${Math.floor(Date.now() / repeatMs)}`
    );
    this.reminderState.profile[openId] = Date.now();
    this.saveReminderState();
    return true;
  }

  createGovernanceAction({ title, projectName = "团队管理", chatId = "", sourceId = "", ownerId = "" }) {
    const row = {
      "行动项": title,
      "所属项目": projectName,
      "群聊ID": chatId,
      "来源消息ID": sourceId,
      "状态": "待确认",
      "置信度": 1,
      "生成时间": toFeishuDate(),
      "Agent版本": this.config.agentVersion
    };
    if (ownerId) row["负责人"] = userCell(ownerId);
    this.lark.createRecords(this.config.tables.actions, [row]);
  }

  async syncManagedGroup(group, { notifyNewMembers = false } = {}) {
    if (!group || this.isExcludedChat(group.chatId)) return;
    const users = this.lark.listChatMemberUsers(group.chatId);
    this.memberRosterByChat.set(group.chatId, new Set(users.map((user) => user.id)));
    const newMemberRows = [];
    const newMembershipRows = [];
    const pendingMemberIds = new Set();

    for (const user of users) {
      let member = this.memberDirectory.get(user.id);
      if (!member && !pendingMemberIds.has(user.id)) {
        newMemberRows.push({
          "姓名": user.name || user.id,
          "飞书成员": userCell(user.id),
          "成员状态": "活跃",
          "成长阶段": "观见习生",
          "加入日期": toFeishuDate()
        });
        pendingMemberIds.add(user.id);
      }

      if (group.type === "project" && group.projectName) {
        const key = membershipKey(group.projectName, user.id);
        if (!this.projectMemberships.has(key)) {
          newMembershipRows.push({
            "关系名称": `${group.projectName}｜${user.name || user.id}`,
            "所属项目": group.projectName,
            "成员": userCell(user.id),
            "项目角色": "其他",
            "关系状态": "待确认",
            "成员类型": "工作室成员",
            "加入日期": toFeishuDate(),
            "说明": `Agent 根据“${group.chatName}”群成员同步创建，项目角色和关系状态待负责人确认。`
          });
        }
      }

      member = member || (pendingMemberIds.has(user.id) ? { grade: "", interests: [], skills: "" } : null);
      if (notifyNewMembers && this.memberProfileIncomplete(member)) {
        try {
          await this.sendProfileReminder(user.id, user.name || "同学");
        } catch (error) {
          console.error(`[agent] 成员档案提醒发送失败：${user.name || user.id}`, error.message);
        }
      }
    }

    this.lark.createRecords(this.config.tables.members, newMemberRows);
    this.lark.createRecords(this.config.tables.projectMemberships, newMembershipRows);
    if (newMemberRows.length || newMembershipRows.length) await this.refreshIdentityMappings();
  }

  async syncManagedGroups(options = {}) {
    if (!this.config.memberGovernance?.enabled) return { groups: 0 };
    const groups = (this.config.memberGovernance.groups || [])
      .filter((group) => !options.chatIds?.length || options.chatIds.includes(group.chatId));
    for (const group of groups) await this.syncManagedGroup(group, options);
    console.log(`[agent] 群成员同步完成：${groups.length} 个纳管群`);
    return { groups: groups.length };
  }

  async sendIncompleteProfileReminders() {
    for (const member of this.memberDirectory.values()) {
      if (member.status === "已退出" || member.grade === "指导教师" || !this.memberProfileIncomplete(member)) continue;
      try {
        await this.sendProfileReminder(member.openId, member.name || "同学");
      } catch (error) {
        console.error(`[agent] 成员档案定期提醒失败：${member.name || member.openId}`, error.message);
      }
    }
  }

  async handleUserMembershipChanged(event, action) {
    const payload = event.event || event;
    const group = this.managedGroup(payload.chat_id);
    if (!group || this.isExcludedChat(payload.chat_id)) return;
    const users = eventMemberUsers(event);

    if (action === "added") {
      await this.syncManagedGroup(group, { notifyNewMembers: true });
      return;
    }

    for (const user of users) {
      if (group.type === "project" && group.projectName) {
        const membership = this.projectMemberships.get(membershipKey(group.projectName, user.id));
        if (membership?.recordId && membership.status !== "已退出") {
          this.lark.updateRecords(this.config.tables.projectMemberships, {
            [membership.recordId]: {
              "关系状态": "暂停",
              "退出日期": toFeishuDate(),
              "说明": `Agent 检测到该成员已离开“${group.chatName}”；是否退出项目仍需负责人确认。`
            }
          });
        }
      }
      this.createGovernanceAction({
        title: `确认${user.name || user.id}离开“${group.chatName}”后的成员或项目关系`,
        projectName: group.projectName || "团队管理",
        chatId: group.chatId,
        sourceId: event.header?.event_id || "",
        ownerId: this.config.notifications?.publisherOpenIds?.[0] || ""
      });
    }
    await this.refreshIdentityMappings();
  }

  automationOperator(openId) {
    return new Set(this.config.automationCommands?.operatorOpenIds || []).has(openId);
  }

  handleAutomationCommand(message, mapping) {
    if (!this.config.automationCommands?.enabled || !this.automationOperator(message.sender_id)) return;
    const content = String(message.content || "");
    const mentionIds = (message.mentions || []).map((mention) => mention.id).filter((id) => id?.startsWith("ou_"));

    if (content.includes("【确认建任务】") && this.config.automationCommands.task?.enabled) {
      const summary = labelValue(content, "任务");
      const due = labelValue(content, "截止");
      const assignee = mentionIds[0] || labelValue(content, "负责人");
      if (!summary || !due || !assignee.startsWith("ou_")) {
        this.createGovernanceAction({
          title: "建任务命令信息不完整：需要【任务】、【负责人】@成员、【截止】",
          projectName: mapping.projectName,
          chatId: message.chat_id,
          sourceId: message.message_id,
          ownerId: message.sender_id
        });
        return;
      }
      this.lark.createTask({
        summary,
        description: `由云机器人根据“${mapping.chatName}”中的明确确认命令创建。来源消息：${message.message_id}`,
        assignee,
        due,
        tasklistId: this.config.automationCommands.task.tasklistId || "",
        idempotencyKey: `task-${message.message_id}`
      });
    }

    if (content.includes("【确认建日程】") && this.config.automationCommands.calendar?.enabled) {
      const summary = labelValue(content, "标题");
      const start = labelValue(content, "开始");
      const end = labelValue(content, "结束");
      if (!summary || !start || !end || !hasExplicitTimezone(start) || !hasExplicitTimezone(end)) {
        this.createGovernanceAction({
          title: "建日程命令信息不完整：需要【标题】、带时区的【开始】和【结束】",
          projectName: mapping.projectName,
          chatId: message.chat_id,
          sourceId: message.message_id,
          ownerId: message.sender_id
        });
        return;
      }
      this.lark.createCalendarEvent({
        summary,
        start,
        end,
        attendeeIds: mentionIds.length ? mentionIds : [message.sender_id],
        description: `由云机器人根据“${mapping.chatName}”中的明确确认命令创建。来源消息：${message.message_id}`
      });
    }
  }

  shouldAcceptMessage(message) {
    if (message.chat_type && message.chat_type !== "group") return false;
    const senderType = message.sender_type || message.sender?.sender_type || message.sender?.type;
    if (this.config.privacy.ignoreBots && senderType === "bot") return false;
    if (!message.message_id || this.processed.has(message.message_id)) return false;
    if ((message.content || "").trim().length < this.config.privacy.minimumContentLength) return false;
    if (this.isExcludedChat(message.chat_id)) return false;
    if (!this.config.privacy.allowAllChats && !this.chatMappings.has(message.chat_id)) return false;
    return true;
  }

  shouldAccept(event) {
    if (event.type !== "im.message.receive_v1") return false;
    return this.shouldAcceptMessage(event);
  }

  isNotificationPublisher(openId) {
    return new Set(this.config.notifications?.publisherOpenIds || []).has(openId);
  }

  shouldTrackNotificationMessage(message) {
    if (!this.config.notifications?.enabled) return false;
    if (!this.isNotificationPublisher(message.sender_id)) return false;
    return this.activeNotifications.has(message.chat_id)
      || startsWithNotificationPrefix(message.content, this.config);
  }

  isTrackableStudent(openId) {
    if (!openId || this.isNotificationPublisher(openId)) return false;
    const member = this.memberDirectory.get(openId);
    return Boolean(member && !["指导教师", "已退出"].includes(member.status) && member.grade !== "指导教师");
  }

  rememberMessage(message, mapping) {
    this.recentMessagesById.set(message.message_id, {
      messageId: message.message_id,
      senderId: message.sender_id,
      chatId: message.chat_id,
      projectName: mapping.projectName,
      content: message.content,
      timeMs: messageTimeMs(message)
    });
    if (this.recentMessagesById.size > 5000) {
      this.recentMessagesById.delete(this.recentMessagesById.keys().next().value);
    }
  }

  handleOperationalTracking(message, mapping) {
    this.rememberMessage(message, mapping);
    try {
      if (this.shouldTrackNotificationMessage(message)) {
        this.trackNotificationMessage(message, mapping);
        return;
      }
      this.trackDiscussionResponse(message, mapping);
    } catch (error) {
      console.error("[agent] 运营追踪失败", error.message);
    }
  }

  trackNotificationMessage(message, mapping) {
    const chatId = message.chat_id;
    const active = this.activeNotifications.get(chatId) || {
      mapping,
      messages: [],
      startedAtMs: messageTimeMs(message)
    };
    active.mapping = mapping;
    active.messages.push(message);
    active.endedAtMs = messageTimeMs(message);
    this.activeNotifications.set(chatId, active);

    const oldTimer = this.notificationIdleTimers.get(chatId);
    if (oldTimer) clearTimeout(oldTimer);
    const idleMs = Math.max(Number(this.config.notifications?.idleMinutes) || 5, 1) * 60 * 1000;
    const timer = setTimeout(() => {
      this.finalizeNotification(chatId).catch((error) => {
        console.error("[agent] 通知摘要生成失败", error.message);
      });
    }, idleMs);
    this.notificationIdleTimers.set(chatId, timer);
  }

  buildNotificationMarkdown(summary, active) {
    const mapping = active.mapping;
    const keyPoints = markdownList(summary.key_points);
    const actions = markdownList(summary.action_items);
    return [
      `**通知摘要｜${summary.title || "请关注"}**`,
      "",
      `项目：${mapping.projectName}`,
      summary.deadline ? `截止时间：${summary.deadline}` : "",
      "",
      summary.summary || "",
      keyPoints ? `\n**重点**\n${keyPoints}` : "",
      actions ? `\n**需要行动**\n${actions}` : "",
      "",
      "有问题请直接在群内讨论。"
    ].filter(Boolean).join("\n");
  }

  async finalizeNotification(chatId) {
    const active = this.activeNotifications.get(chatId);
    if (!active || !active.messages.length) return;
    this.activeNotifications.delete(chatId);
    const timer = this.notificationIdleTimers.get(chatId);
    if (timer) clearTimeout(timer);
    this.notificationIdleTimers.delete(chatId);

    const summary = await this.analyzer.summarizeNotification({
      projectName: active.mapping.projectName,
      chatName: active.mapping.chatName,
      messages: active.messages.map((message) => ({
        ...message,
        content: stripNotificationPrefix(message.content, this.config)
      }))
    });
    const sourceMessageIds = active.messages.map((message) => message.message_id);
    const id = noticeId(chatId, sourceMessageIds);
    const markdown = this.buildNotificationMarkdown(summary, active);
    let summaryMessageId = "";
    let sendError = "";
    const sentAtMs = Date.now();

    if (this.config.notifications?.sendSummaryToGroup) {
      try {
        const output = this.lark.sendMarkdown(chatId, markdown, `notice-${sourceMessageIds.at(-1) || Date.now()}`);
        summaryMessageId = messageIdFromSend(output);
      } catch (error) {
        sendError = error.message.slice(0, 500);
      }
    }

    const trackingDeadlineMs = sentAtMs + Math.min(
      Math.max(Number(this.config.notifications?.readTracking?.trackingDays) || 7, 1),
      7
    ) * 24 * 60 * 60 * 1000;
    const recordOutput = this.lark.createRecords(this.config.tables.notifications, [{
      "通知ID": id,
      "通知标题": summary.title || "未命名通知",
      "通知摘要": summary.summary || compactText(active.messages.map((message) => message.content).join("\n")),
      "群聊ID": chatId,
      "群聊名称": active.mapping.chatName,
      "所属项目": active.mapping.projectName,
      "发布人": userCell(active.messages[0].sender_id),
      "原始消息ID": compactIds(sourceMessageIds),
      "原始消息数": active.messages.length,
      "通知开始时间": toFeishuDate(active.startedAtMs),
      "通知结束时间": toFeishuDate(active.endedAtMs),
      "摘要消息ID": summaryMessageId,
      "摘要发送时间": summaryMessageId ? toFeishuDate(sentAtMs) : null,
      "阅读状态": summaryMessageId ? "跟踪中" : "发送失败",
      "已读人数": 0,
      "未读人数": 0,
      "群成员数": 0,
      "同步说明": sendError,
      "跟踪截止时间": toFeishuDate(trackingDeadlineMs),
      "Agent版本": this.config.agentVersion
    }]);

    const recordId = firstRecordIdFromCreate(recordOutput);
    if (summaryMessageId && this.config.notifications?.readTracking?.enabled) {
      const tracked = {
        noticeId: id,
        recordId,
        chatId,
        chatName: active.mapping.chatName,
        projectName: active.mapping.projectName,
        summaryMessageId,
        sentAtMs,
        deadlineMs: trackingDeadlineMs
      };
      this.trackedNotifications.set(id, tracked);
      await this.syncNotificationReadStatus(tracked);
    }
  }

  trackDiscussionResponse(message, mapping) {
    if (!this.config.responseTracking?.enabled || !this.isTrackableStudent(message.sender_id)) return;

    const current = {
      messageId: message.message_id,
      senderId: message.sender_id,
      chatId: message.chat_id,
      projectName: mapping.projectName,
      content: message.content,
      timeMs: messageTimeMs(message)
    };

    if (message.reply_to) {
      const source = this.recentMessagesById.get(message.reply_to) || {
        messageId: message.reply_to,
        senderId: "",
        chatId: message.chat_id,
        projectName: mapping.projectName,
        content: "",
        timeMs: 0
      };
      this.createResponseMetric(source, current, "引用回复");
    } else {
      const previous = this.lastDiscussionByChat.get(message.chat_id);
      if (previous && previous.senderId !== current.senderId) {
        const gap = minutesBetween(previous.timeMs, current.timeMs);
        const maxGap = Math.max(Number(this.config.responseTracking.maxSequentialGapMinutes) || 360, 1);
        if (gap <= maxGap) this.createResponseMetric(previous, current, "顺序接话");
      }
    }

    this.lastDiscussionByChat.set(message.chat_id, current);
  }

  createResponseMetric(source, response, responseType) {
    const minutes = source.timeMs ? minutesBetween(source.timeMs, response.timeMs) : 0;
    const slowMinutes = Math.max(Number(this.config.responseTracking?.slowReplyMinutes) || 120, 1);
    const row = {
      "响应ID": `${source.messageId || "unknown"}:${response.messageId}`.slice(0, 240),
      "群聊ID": response.chatId,
      "所属项目": response.projectName,
      "被响应消息ID": source.messageId || "",
      "被响应成员": userCell(source.senderId),
      "被响应时间": source.timeMs ? toFeishuDate(source.timeMs) : null,
      "回复消息ID": response.messageId,
      "回复成员": userCell(response.senderId),
      "回复时间": toFeishuDate(response.timeMs),
      "响应耗时分钟": minutes,
      "响应类型": responseType,
      "是否超时": Boolean(minutes && minutes >= slowMinutes),
      "Agent版本": this.config.agentVersion
    };
    if (!row["被响应成员"]) delete row["被响应成员"];
    this.lark.createRecords(this.config.tables.responseMetrics, [row]);
  }

  async loadTrackedNotifications() {
    if (!this.config.notifications?.readTracking?.enabled) return;
    try {
      const output = this.lark.listRecords(this.config.tables.notifications, [
        "通知ID", "群聊ID", "群聊名称", "所属项目", "摘要消息ID", "摘要发送时间", "阅读状态", "跟踪截止时间"
      ]);
      for (const record of recordsFrom(output)) {
        const fields = fieldsFrom(record);
        if (selectValue(fields["阅读状态"]) !== "跟踪中" || !fields["摘要消息ID"]) continue;
        const deadlineMs = messageTimeMs({ create_time: fields["跟踪截止时间"] || Date.now() });
        if (deadlineMs <= Date.now()) continue;
        this.trackedNotifications.set(fields["通知ID"], {
          noticeId: fields["通知ID"],
          recordId: recordIdFrom(record),
          chatId: fields["群聊ID"],
          chatName: fields["群聊名称"] || fields["群聊ID"],
          projectName: fields["所属项目"] || "",
          summaryMessageId: fields["摘要消息ID"],
          sentAtMs: messageTimeMs({ create_time: fields["摘要发送时间"] || Date.now() }),
          deadlineMs
        });
      }
      console.log(`[agent] 已加载 ${this.trackedNotifications.size} 条通知阅读追踪`);
    } catch (error) {
      console.error("[agent] 加载通知阅读追踪失败", error.message);
    }
  }

  async syncAllNotificationReads() {
    for (const notice of [...this.trackedNotifications.values()]) {
      await this.syncNotificationReadStatus(notice);
    }
  }

  async syncNotificationReadStatus(notice) {
    if (!notice.summaryMessageId) return;
    const now = Date.now();
    const expired = now >= notice.deadlineMs;
    let syncNote = "";
    let chatMembers = [];

    try {
      chatMembers = this.lark.listChatMemberUsers(notice.chatId);
    } catch (error) {
      syncNote = `群成员列表读取失败：${error.message.slice(0, 160)}`;
    }

    const readUsers = this.lark.readMessageUsers(notice.summaryMessageId);
    const readAtById = new Map(readUsers.map((item) => [item.id, item.readAt]));
    const memberIds = chatMembers.map((member) => member.id);
    const readIds = memberIds.length
      ? memberIds.filter((id) => readAtById.has(id))
      : readUsers.map((item) => item.id);
    const unreadIds = memberIds.length ? memberIds.filter((id) => !readAtById.has(id)) : [];
    const allRead = memberIds.length > 0 && unreadIds.length === 0;
    const status = allRead ? "全部已读" : expired ? "已过期" : "跟踪中";
    const lastSync = toFeishuDate(now);

    if (notice.recordId) {
      this.lark.updateRecords(this.config.tables.notifications, {
        [notice.recordId]: {
          "阅读状态": status,
          "已读人数": readIds.length,
          "未读人数": unreadIds.length,
          "群成员数": memberIds.length,
          "已读成员ID": compactIds(readIds),
          "未读成员ID": compactIds(unreadIds),
          "最后同步时间": lastSync,
          "同步说明": syncNote
        }
      });
    }

    this.upsertNotificationReadDetails(notice, chatMembers, readAtById, lastSync);
    await this.remindUnreadNotificationMembers(notice, unreadIds, now);
    if (allRead || expired) this.trackedNotifications.delete(notice.noticeId);
  }

  async remindUnreadNotificationMembers(notice, unreadIds, now) {
    const settings = this.config.notifications?.readTracking || {};
    if (!settings.sendPrivateReminder || !unreadIds.length) return;
    const thresholdMs = Math.max(Number(settings.reminderAfterHours) || 8, 1) * 60 * 60 * 1000;
    if (now - notice.sentAtMs < thresholdMs) return;

    for (const openId of unreadIds) {
      if (!this.isTrackableStudent(openId)) continue;
      const key = `${notice.noticeId}:${openId}`;
      if (settings.remindOnlyOnce !== false && this.reminderState.notification[key]) continue;
      const member = this.memberDirectory.get(openId);
      try {
        this.lark.sendPrivateText(
          openId,
          `${member?.name || "同学"}你好，“${notice.chatName}”中有一条通知摘要发布超过 8 小时仍未显示已读。请在方便时查看群内由云机器人发送的通知摘要；这是一条一次性提醒，无需单独回复。`,
          `unread-${notice.summaryMessageId.slice(-18)}-${openId.slice(-12)}`
        );
        this.reminderState.notification[key] = Date.now();
        this.saveReminderState();
      } catch (error) {
        console.error(`[agent] 通知未读私聊提醒失败：${member?.name || openId}`, error.message);
      }
    }
  }

  upsertNotificationReadDetails(notice, chatMembers, readAtById, lastSync) {
    if (!chatMembers.length) return;
    const output = this.lark.listRecords(this.config.tables.notificationReads, [
      "阅读记录ID", "阅读状态", "首次已读时间"
    ]);
    const existing = new Map(recordsFrom(output).map((record) => {
      const fields = fieldsFrom(record);
      return [fields["阅读记录ID"], { recordId: recordIdFrom(record), fields }];
    }));
    const creates = [];
    const updates = {};

    for (const member of chatMembers) {
      const id = `${notice.noticeId}:${member.id}`.slice(0, 240);
      const readAt = readAtById.get(member.id);
      const baseFields = {
        "通知ID": notice.noticeId,
        "摘要消息ID": notice.summaryMessageId,
        "群聊ID": notice.chatId,
        "所属项目": notice.projectName,
        "成员": userCell(member.id),
        "成员OpenID": member.id,
        "阅读状态": readAt ? "已读" : "未读",
        "最后同步时间": lastSync,
        "Agent版本": this.config.agentVersion
      };
      if (readAt) baseFields["首次已读时间"] = toFeishuDate(readAt);

      const current = existing.get(id);
      if (!current) {
        creates.push({ "阅读记录ID": id, ...baseFields });
      } else {
        const firstReadAt = current.fields["首次已读时间"];
        updates[current.recordId] = {
          ...baseFields,
          "首次已读时间": firstReadAt || baseFields["首次已读时间"] || null
        };
      }
    }

    this.lark.createRecords(this.config.tables.notificationReads, creates);
    this.lark.updateRecords(this.config.tables.notificationReads, updates);
  }

  accept(event) {
    if (event.type !== "im.message.receive_v1") return;
    this.lastMessageAt = Date.now();
    this.touchGroupHealth(event.chat_id, { lastMessageAt: this.lastMessageAt });
    if (!this.chatMappings.has(event.chat_id) && !this.isExcludedChat(event.chat_id)) {
      this.ensureAutoChatConfig(event.chat_id, event.chat_name || event.chat_id)
        .then((enabled) => {
          if (enabled) this.accept(event);
        })
        .catch((error) => console.error("[agent] 自动接入新群失败", error.message));
      return;
    }
    if (!this.shouldAccept(event) || this.inFlight.has(event.message_id)) return;
    const sanitized = sanitizeMessages([event]);
    const safeEvent = sanitized.messages[0];
    this.inFlight.add(event.message_id);

    const mapping = this.chatMappings.get(event.chat_id) || {
      chatId: event.chat_id,
      chatName: event.chat_id,
      projectName: "待归属项目",
      allowDocumentDrafts: false
    };
    try {
      this.handleAutomationCommand(safeEvent, mapping);
    } catch (error) {
      console.error("[agent] 飞书任务/日程命令执行失败", error.message);
    }
    this.handleOperationalTracking(safeEvent, mapping);
    const batch = this.batches.get(event.chat_id) || {
      mapping,
      messages: [],
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now()
    };
    batch.mapping = mapping;
    batch.messages.push(safeEvent);
    batch.redactionTypes = [...new Set([...(batch.redactionTypes || []), ...sanitized.detections])];
    batch.lastSeenAt = Date.now();
    this.batches.set(event.chat_id, batch);
  }

  async flushDueBatches() {
    const idleMs = conversationIdleMs(this.config);
    for (const [chatId, batch] of this.batches) {
      if (batch.retryAt && batch.retryAt > Date.now()) continue;
      if (Date.now() - (batch.lastSeenAt || batch.firstSeenAt) >= idleMs) await this.flushChat(chatId);
    }
  }

  async flushChat(chatId) {
    return this.flushBatch(this.batches.get(chatId), "实时消息");
  }

  existingRecordKeys(tableName, fieldName) {
    const output = this.lark.listRecords(tableName, [fieldName]);
    return new Set(recordsFrom(output)
      .map((record) => String(fieldsFrom(record)[fieldName] || "").trim())
      .filter(Boolean));
  }

  filterNewRows(rows, existingKeys, keyField) {
    const seen = new Set();
    return rows.filter((row) => {
      const key = String(row[keyField] || "").trim();
      if (!key || existingKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  upsertByKey(tableName, keyField, keyValue, fields) {
    if (!tableName || !keyValue) return;
    const current = this.lark.findRecordByField(tableName, keyField, keyValue);
    const recordId = current ? recordIdFrom(current) : "";
    if (recordId) this.lark.updateRecords(tableName, { [recordId]: fields });
    else this.lark.createRecords(tableName, [fields]);
  }

  touchGroupHealth(chatId, patch = {}) {
    if (!chatId) return;
    const mapping = this.chatMappings.get(chatId) || {};
    const current = this.groupHealth.get(chatId) || {
      chatId,
      chatName: mapping.chatName || chatId,
      projectName: mapping.projectName || "",
      enabled: mapping.enabled !== false,
      lastMessageAt: 0,
      lastAnalysisAt: 0,
      lastMemberSyncAt: 0,
      consecutiveFailures: 0,
      lastError: "",
      lastErrorAt: 0
    };
    this.groupHealth.set(chatId, { ...current, ...patch });
  }

  recordRuntimeEvent(event = {}) {
    if (this.config.health?.enabled === false || !this.config.tables.runtimeEvents) return;
    try {
      const now = Date.now();
      this.runtimeEventSequence += 1;
      const row = {
        "事件ID": `${this.config.health?.instanceId || "cloudagent-main"}:${now}:${this.runtimeEventSequence}`,
        "事件类型": event.type || "分析失败",
        "严重级别": event.severity || "警告",
        "执行状态": event.success === false ? "失败" : "成功",
        "实例ID": this.config.health?.instanceId || "cloudagent-main",
        "用途": event.purpose || "",
        "提供方": event.provider || this.config.provider || "",
        "模型": event.model || this.config.model || "",
        "所属项目": event.projectName || "",
        "群聊ID": event.chatId || "",
        "批次ID": event.batchId || "",
        "开始时间": toFeishuDate(event.startedAt || now),
        "结束时间": toFeishuDate(event.endedAt || now),
        "耗时毫秒": Math.max(Number(event.endedAt || now) - Number(event.startedAt || now), 0),
        "输入Token": Number(event.inputTokens || 0),
        "缓存输入Token": Number(event.cachedInputTokens || 0),
        "输出Token": Number(event.outputTokens || 0),
        "总Token": Number(event.totalTokens || 0),
        "费用币种": this.config.modelPricing?.currency || "",
        "错误类型": event.errorType || "",
        "错误信息": String(event.errorMessage || "").slice(0, 1000),
        "Agent版本": this.config.agentVersion,
        "创建时间": toFeishuDate(now)
      };
      if (Number.isFinite(event.estimatedCost)) row["预计费用"] = event.estimatedCost;
      this.lark.createRecords(this.config.tables.runtimeEvents, [row]);
    } catch (error) {
      console.error("[agent] 运行事件写入失败", error.message);
    }
  }

  recordModelTelemetry(event) {
    const usage = normalizeModelUsage(event.usage || {});
    const estimatedCost = estimateModelCost(usage, this.config.modelPricing || {});
    this.modelUsageTotals.calls += 1;
    this.modelUsageTotals.tokens += usage.totalTokens;
    if (Number.isFinite(estimatedCost)) this.modelUsageTotals.cost += estimatedCost;
    this.modelHealth = event.success ? "正常" : "异常";
    if (!event.success) {
      this.lastRuntimeError = String(event.error?.message || "模型调用失败").slice(0, 1000);
      this.lastRuntimeErrorAt = Date.now();
    }
    const errorStatus = Number(event.error?.status || event.error?.code || 0);
    this.recordRuntimeEvent({
      type: "模型调用",
      severity: event.success ? "信息" : [401, 402, 403, 429].includes(errorStatus) ? "高" : "警告",
      success: event.success,
      purpose: event.purpose,
      provider: this.config.provider,
      model: this.config.model,
      projectName: event.projectName || "",
      chatId: event.chatId || "",
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      ...usage,
      estimatedCost,
      errorType: event.error?.name || (errorStatus ? String(errorStatus) : ""),
      errorMessage: event.error?.message || ""
    });
  }

  writeHealthStatus(requestedStatus = "运行中") {
    if (this.config.health?.enabled === false || !this.config.tables.healthStatus) return;
    for (const mapping of this.chatMappings.values()) {
      this.touchGroupHealth(mapping.chatId, { chatName: mapping.chatName, projectName: mapping.projectName, enabled: mapping.enabled !== false });
    }
    const maxFailures = Math.max(0, ...[...this.groupHealth.values()].map((item) => Number(item.consecutiveFailures || 0)));
    const pending = this.pendingBatchStore.list();
    const permanentFailures = pending.filter((batch) => Number(batch.retryAttempt || 0) >= Number(this.config.reliability?.maxAttempts || 5)).length;
    const audit = this.shadowAcceptanceState?.lastAudit || {};
    const fields = {
      "实例ID": this.config.health?.instanceId || "cloudagent-main",
      "运行状态": runtimeStatus({ requestedStatus, retryCount: this.retryTimers.size, consecutiveFailures: maxFailures }),
      "Agent版本": this.config.agentVersion,
      "运行位置": this.config.health?.location || "",
      "进程PID": process.pid,
      "启动时间": toFeishuDate(this.runtimeStartedAt),
      "最近心跳": toFeishuDate(),
      "运行时长秒": Math.floor((Date.now() - this.runtimeStartedAt) / 1000),
      "监听群数量": this.chatMappings.size,
      "成员数量": this.memberDirectory.size,
      "项目关系数量": this.projectMemberships.size,
      "待分析会话数": this.batches.size,
      "待重试批次数": this.retryTimers.size,
      "永久失败数": permanentFailures,
      "飞书权限状态": "正常",
      "模型连接状态": this.modelHealth,
      "本次运行模型调用": this.modelUsageTotals.calls,
      "本次运行Token": this.modelUsageTotals.tokens,
      "本次运行预计费用": this.modelUsageTotals.cost,
      "费用币种": this.config.modelPricing?.currency || "",
      "影子样本数": Number(audit.eligible || 0),
      "影子已审核数": Number(audit.reviewed || 0),
      "影子精确率": Number(audit.precision || 0),
      "影子验收状态": audit.readyForManualPromotion ? "可人工晋级" : "观察中",
      "最后错误": this.lastRuntimeError,
      "备注": "运行告警仅私聊负责人，不发送群消息。"
    };
    if (this.lastMessageAt) fields["最近收到消息"] = toFeishuDate(this.lastMessageAt);
    if (this.lastAnalysisAt) fields["最近完成分析"] = toFeishuDate(this.lastAnalysisAt);
    if (this.lastWeeklyReportAt) fields["最近周报时间"] = toFeishuDate(this.lastWeeklyReportAt);
    if (this.lastMonthlyReportAt) fields["最近月报时间"] = toFeishuDate(this.lastMonthlyReportAt);
    if (this.lastRuntimeErrorAt) fields["最后错误时间"] = toFeishuDate(this.lastRuntimeErrorAt);
    this.upsertByKey(this.config.tables.healthStatus, "实例ID", fields["实例ID"], fields);
    for (const health of this.groupHealth.values()) {
      const groupFields = {
        "群聊ID": health.chatId,
        "群聊名称": health.chatName || health.chatId,
        "所属项目": health.projectName || "",
        "启用监听": Boolean(health.enabled),
        "监听状态": health.enabled === false ? "排除" : Number(health.consecutiveFailures || 0) >= Number(this.config.health?.groupFailureThreshold || 3) ? "异常" : Number(health.consecutiveFailures || 0) > 0 ? "降级" : "正常",
        "待分析消息数": this.batches.get(health.chatId)?.messages?.length || 0,
        "连续失败次数": Number(health.consecutiveFailures || 0),
        "最后错误": health.lastError || "",
        "最近心跳": toFeishuDate(),
        "Agent版本": this.config.agentVersion
      };
      if (health.lastMessageAt) groupFields["最近收到消息"] = toFeishuDate(health.lastMessageAt);
      if (health.lastAnalysisAt) groupFields["最近完成分析"] = toFeishuDate(health.lastAnalysisAt);
      if (health.lastMemberSyncAt) groupFields["最近成员同步"] = toFeishuDate(health.lastMemberSyncAt);
      if (health.lastErrorAt) groupFields["最后错误时间"] = toFeishuDate(health.lastErrorAt);
      this.upsertByKey(this.config.tables.groupHealth, "群聊ID", health.chatId, groupFields);
    }
  }

  saveWorkStyleState() {
    fs.mkdirSync(path.dirname(this.workStyleStateFile), { recursive: true });
    fs.writeFileSync(this.workStyleStateFile, `${JSON.stringify(this.workStyleState, null, 2)}\n`, "utf8");
  }

  async generateWeeklyWorkStyleObservations() {
    const settings = this.config.evidenceGovernance || {};
    if (!this.config.tables.conclusionLedger || settings.enabled === false) return { created: 0 };
    const intervalMs = Math.max(Number(settings.workStyleIntervalHours) || 168, 1) * 60 * 60 * 1000;
    if (this.workStyleState.lastRunAt && Date.now() - Date.parse(this.workStyleState.lastRunAt) < intervalMs) return { created: 0, skipped: true };
    const output = this.lark.listRecords(this.config.tables.conclusionLedger, [
      "结论ID", "结论层级", "结论类型", "结论正文", "观察成员OpenID", "批次ID", "审核状态", "来源消息ID", "原始消息链接", "证据开始时间", "证据结束时间"
    ]);
    const facts = recordsFrom(output).map((record) => {
      const fields = fieldsFrom(record);
      return {
        claimId: fields["结论ID"], level: selectValue(fields["结论层级"]), type: selectValue(fields["结论类型"]), text: fields["结论正文"],
        memberOpenId: String(fields["观察成员OpenID"] || "").split("、")[0], batchId: fields["批次ID"], reviewStatus: selectValue(fields["审核状态"]),
        sourceMessageIds: String(fields["来源消息ID"] || "").split("、").filter(Boolean), links: String(fields["原始消息链接"] || "").split("\n").filter(Boolean),
        evidenceStartedAt: fields["证据开始时间"], evidenceEndedAt: fields["证据结束时间"], createdAt: fields["证据结束时间"]
      };
    }).filter((row) => row.type === "贡献" && row.memberOpenId);
    const eligible = eligibleConfirmedFacts(facts, { windowDays: settings.workStyleWindowDays || 7 });
    const byMember = new Map();
    for (const fact of eligible) {
      if (!byMember.has(fact.memberOpenId)) byMember.set(fact.memberOpenId, []);
      byMember.get(fact.memberOpenId).push(fact);
    }
    const existing = this.existingRecordKeys(this.config.tables.conclusionLedger, "结论ID");
    const creates = [];
    let hadCandidates = false;
    for (const [memberOpenId, memberFacts] of byMember) {
      if (memberFacts.length < Number(settings.minimumFacts || 3) || new Set(memberFacts.map((fact) => fact.batchId)).size < Number(settings.minimumBatches || 2)) continue;
      hadCandidates = true;
      const result = await this.analyzer.evaluateWorkStyle({ memberOpenId, facts: memberFacts.map((fact) => ({ claim_id: fact.claimId, batch_id: fact.batchId, fact: fact.text })) });
      for (const observation of result.observations || []) {
        const validated = validateWorkStyleObservation(observation, memberFacts);
        if (!validated) continue;
        const sourceFacts = validated.sourceClaimIds.map((id) => memberFacts.find((fact) => fact.claimId === id)).filter(Boolean);
        const claimId = buildFactId({ type: "work-style", subjectId: memberOpenId, sourceMessageIds: validated.sourceClaimIds, content: `${observation.dimension}\n${observation.observation}` });
        if (existing.has(claimId)) continue;
        const sourceMessages = [...new Set(sourceFacts.flatMap((fact) => fact.sourceMessageIds))];
        const links = [...new Set(sourceFacts.flatMap((fact) => fact.links))];
        const starts = sourceFacts.map((fact) => Date.parse(fact.evidenceStartedAt)).filter(Number.isFinite);
        const ends = sourceFacts.map((fact) => Date.parse(fact.evidenceEndedAt)).filter(Number.isFinite);
        creates.push({
          "结论ID": claimId, "结论层级": "评价", "结论类型": "工作风格评价", "结论正文": observation.observation,
          "证据说明": `维度：${observation.dimension}；引用确认事实：${validated.sourceClaimIds.join("、")}`,
          "观察成员": [{ id: memberOpenId }], "观察成员OpenID": memberOpenId, "批次ID": validated.batchIds.join("、"),
          "来源消息ID": sourceMessages.join("、"), "原始消息链接": links.join("\n"), "证据数量": validated.sourceClaimIds.length,
          "批次数量": validated.batchIds.length, "证据开始时间": starts.length ? toFeishuDate(Math.min(...starts)) : null,
          "证据结束时间": ends.length ? toFeishuDate(Math.max(...ends)) : null, "置信度": observation.confidence,
          "敏感等级": "高", "是否需要人工审核": true, "审核状态": "待审核", "Agent版本": this.config.agentVersion, "生成时间": toFeishuDate()
        });
        existing.add(claimId);
      }
    }
    this.lark.createRecords(this.config.tables.conclusionLedger, creates);
    if (hadCandidates) {
      this.workStyleState.lastRunAt = new Date().toISOString();
      this.saveWorkStyleState();
    }
    return { created: creates.length };
  }

  async syncConfirmedEvaluations() {
    const mode = this.config.evidenceGovernance?.mode || "shadow";
    if (!this.config.tables.conclusionLedger) return { linked: 0 };
    const output = this.lark.listRecords(this.config.tables.conclusionLedger, ["结论ID", "结论层级", "审核状态", "观察成员OpenID", "证据数量", "批次数量", "关联成员档案"]);
    const updates = {};
    for (const record of recordsFrom(output)) {
      const fields = fieldsFrom(record);
      if (selectValue(fields["结论层级"]) !== "评价") continue;
      const row = { level: "评价", reviewStatus: selectValue(fields["审核状态"]), evidenceCount: fields["证据数量"], batchCount: fields["批次数量"] };
      const currentLink = fields["关联成员档案"];
      if (!canLinkEvaluationToMember(row, mode)) {
        if (currentLink && (!Array.isArray(currentLink) || currentLink.length)) updates[recordIdFrom(record)] = { "关联成员档案": [] };
        continue;
      }
      if (currentLink && (!Array.isArray(currentLink) || currentLink.length)) continue;
      const openId = String(fields["观察成员OpenID"] || "").trim();
      const identity = this.resolveIdentity(openId, "");
      if (identity.memberRecordId) updates[recordIdFrom(record)] = { "关联成员档案": [{ id: identity.memberRecordId }] };
    }
    this.lark.updateRecords(this.config.tables.conclusionLedger, updates);
    return { linked: Object.keys(updates).length };
  }

  writeMessageIndexes(batch, batchId, state = {}) {
    const table = this.config.tables.messageIndex;
    if (!table) return;
    const now = toFeishuDate();
    for (const message of batch.messages) {
      this.upsertByKey(table, "消息ID", message.message_id, {
        "消息ID": message.message_id,
        "群聊ID": batch.mapping.chatId,
        "群聊名称": batch.mapping.chatName,
        "发送成员": userCell(message.sender_id),
        "消息时间": toFeishuDate(message.create_time),
        "回复消息ID": message.parent_id || message.root_id || "",
        "内容指纹": contentFingerprint(message.content || message.text || ""),
        "内容字符数": String(message.content || message.text || "").length,
        "敏感信息类型": (batch.redactionTypes || []).join("、"),
        "批次ID": batchId,
        "处理状态": state.status || "待处理",
        "处理阶段": state.stage || "批次收集",
        "错误信息": String(state.error || "").slice(0, 1000),
        "重试次数": Number(state.attempt || 0),
        "首次处理": state.firstSeen || now,
        "最后处理": now,
        "Agent版本": this.config.agentVersion
      });
    }
  }

  writeBatchState(batch, batchId, source, state = {}) {
    const table = this.config.tables.analysisBatches;
    if (!table) return;
    this.upsertByKey(table, "批次ID", batchId, {
      "批次ID": batchId,
      "来源": source,
      "群聊ID": batch.mapping.chatId,
      "群聊名称": batch.mapping.chatName,
      "开始时间": toFeishuDate(batch.messages[0]?.create_time),
      "结束时间": toFeishuDate(batch.messages.at(-1)?.create_time),
      "消息数量": batch.messages.length,
      "消息ID": compactIds(batch.messages.map((message) => message.message_id)),
      "处理状态": state.status || "待处理",
      "处理阶段": state.stage || "批次收集",
      "重试次数": Number(state.attempt || 0),
      "下次重试": state.nextRetryAt ? toFeishuDate(state.nextRetryAt) : null,
      "模型": this.config.routing?.semanticModel || this.config.model || "",
      "错误信息": String(state.error || "").slice(0, 1000),
      "敏感信息类型": (batch.redactionTypes || []).join("、"),
      "Agent版本": this.config.agentVersion,
      "创建时间": toFeishuDate(batch.firstSeenAt),
      "完成时间": state.status === "成功" ? toFeishuDate() : null
    });
  }

  async refreshRoutingCatalog() {
    const projectOutput = this.lark.listRecords(this.config.tables.projects, ["项目名称", "项目别名", "项目状态"]);
    this.projectCatalog = recordsFrom(projectOutput).map((record) => {
      const fields = fieldsFrom(record);
      return {
        recordId: recordIdFrom(record),
        name: String(fields["项目名称"] || "").trim(),
        aliases: String(fields["项目别名"] || "").split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean),
        status: selectValue(fields["项目状态"])
      };
    }).filter((project) => project.recordId && project.name && !["已完成", "已归档"].includes(project.status));

    const projectByName = new Map(this.projectCatalog.map((project) => [project.name, project]));
    const routeOutput = this.lark.listRecords(this.config.tables.chatConfig, [
      "群聊ID", "群聊名称", "所属项目", "群聊类型", "允许多项目归属", "路由模式", "分析组织管理"
    ]);
    for (const record of recordsFrom(routeOutput)) {
      const fields = fieldsFrom(record);
      const mapping = this.chatMappings.get(fields["群聊ID"]);
      if (!mapping) continue;
      const project = projectByName.get(mapping.projectName);
      mapping.projectRecordId = project?.recordId || "";
      mapping.chatType = selectValue(fields["群聊类型"]) || (mapping.chatName === "开发组" ? "混合" : "项目专属");
      mapping.allowMultiProject = Boolean(fields["允许多项目归属"]);
      mapping.routeMode = selectValue(fields["路由模式"]) || (mapping.chatName === "开发组" ? "影子" : "正式");
      mapping.analyzeOperations = Boolean(fields["分析组织管理"]);
    }
    this.projectRouter = new ProjectRouter({
      projects: this.projectCatalog,
      operationsProjectName: this.config.routing?.operationsProjectName || "工作室运营 / 多项目混合"
    });
  }

  async routeBatch(batch, batchId, options = {}) {
    const mapping = batch.mapping;
    if (!this.config.tables.messageRoutes || mapping.routeMode === "关闭") return [];
    let deterministic = this.projectRouter.routeRound({ mapping, messages: batch.messages });
    if (options.deterministicOnly) {
      deterministic = deterministic.filter((route) => route.reviewStatus === "自动确认");
    }
    const unresolvedIds = new Set(deterministic
      .filter((route) => route.reviewStatus === "待确认")
      .map((route) => route.messageId));
    let suggestions = [];
    if (!options.deterministicOnly && options.semanticSuggestions !== false && unresolvedIds.size && this.config.routing?.semanticSuggestions !== false) {
      suggestions = await safeSemanticSuggestions(
        this.semanticRoutingAnalyzer,
        {
          messages: batch.messages.filter((message) => unresolvedIds.has(message.message_id)),
          projects: this.projectCatalog
        },
        (error) => console.warn(`[agent] 语义路由暂不可用，保留待确认路由：${error.message}`)
      );
      suggestions = suggestions.filter((suggestion) => suggestion.projectName && unresolvedIds.has(suggestion.messageId));
    }
    const suggestedIds = new Set(suggestions.filter((item) => item.projectName).map((item) => item.messageId));
    const routes = deterministic.filter((route) => !suggestedIds.has(route.messageId) || route.reviewStatus !== "待确认");
    for (const suggestion of suggestions) {
      const project = this.projectCatalog.find((item) => item.name === suggestion.projectName);
      routes.push({
        routeId: buildRouteId({ messageId: suggestion.messageId, scopeType: suggestion.routeType, projectId: project?.recordId || "" }),
        messageId: suggestion.messageId,
        senderOpenId: batch.messages.find((message) => message.message_id === suggestion.messageId)?.sender_id || "",
        scopeType: suggestion.routeType,
        projectRecordId: project?.recordId || "",
        projectName: project?.name || "",
        basis: suggestion.basis,
        confidence: suggestion.confidence,
        reviewStatus: "待确认",
        candidateAlias: "",
        reason: suggestion.reason
      });
    }

    const reviewers = selectReviewerOpenIds([...this.memberDirectory.values()]);
    const messagesById = new Map(batch.messages.map((message) => [message.message_id, message]));
    const rows = routes.map((route) => {
      const message = messagesById.get(route.messageId) || {};
      const effectiveReviewStatus = reviewStatusForMode(route.reviewStatus, mapping.routeMode);
      const directoryMember = this.memberDirectory.get(route.senderOpenId) || {};
      const reviewFields = buildMessageReviewFields({
        message: {
          ...message,
          sender: {
            ...(message.sender || {}),
            name: message.sender?.name || directoryMember.name || directoryMember.memberName || directoryMember.displayName || ""
          }
        },
        route: { ...route, reviewStatus: effectiveReviewStatus },
        chatName: mapping.chatName
      });
      const row = {
        "消息概览": reviewFields.messageOverview,
        "内部路由ID": route.routeId,
        "消息ID": route.messageId,
        "批次ID": batchId,
        "群聊ID": mapping.chatId,
        "群聊名称": mapping.chatName,
        "消息时间": toFeishuDate(message.create_time),
        "消息链接": message.message_app_link || "",
        "消息内容预览": reviewFields.messagePreview,
        "发送成员": userCell(route.senderOpenId),
        "发送人姓名": reviewFields.senderName,
        "归属类型": route.scopeType === "项目" ? "项目" : route.scopeType === "工作室运营" ? "组织管理" : "无法判断",
        "正式项目名称": route.projectName || "",
        "Agent建议归属": reviewFields.suggestedOwnership,
        "归属依据": route.reason ? `${route.basis}：${route.reason}` : route.basis,
        "判断说明": reviewFields.judgmentExplanation,
        "置信度": route.confidence,
        "路由模式": mapping.routeMode === "正式" ? "正式" : "影子",
        "审核状态": effectiveReviewStatus,
        "审核提示": reviewFields.reviewPrompt,
        "候选别名": route.candidateAlias || "",
        "候选别名状态": route.candidateAlias ? "待确认" : "无",
        "审核负责人": reviewers.map((id) => ({ id })),
        "通知状态": effectiveReviewStatus === "待确认" ? "未通知" : "已通知",
        "已通知负责人ID": "",
        "Agent版本": this.config.agentVersion,
        "创建时间": toFeishuDate()
      };
      if (route.projectRecordId) row["关联项目"] = [{ id: route.projectRecordId }];
      if (!row["发送成员"]) delete row["发送成员"];
      if (!row["审核负责人"].length) delete row["审核负责人"];
      return row;
    });
    const newRows = this.filterNewRows(
      rows,
      this.existingRecordKeys(this.config.tables.messageRoutes, "内部路由ID"),
      "内部路由ID"
    );
    this.lark.createRecords(this.config.tables.messageRoutes, newRows);
    return routes;
  }

  async auditShadowAcceptance() {
    if (!this.config.tables.messageRoutes) return { audit: null, notificationsSent: 0 };
    const output = this.lark.listRecords(this.config.tables.messageRoutes, [
      "内部路由ID", "路由模式", "归属依据", "审核状态", "创建时间"
    ]);
    const routes = recordsFrom(output).map((record) => {
      const fields = fieldsFrom(record);
      return {
        routeId: String(fields["内部路由ID"] || ""),
        routeMode: selectValue(fields["路由模式"]),
        basis: String(fields["归属依据"] || ""),
        reviewStatus: selectValue(fields["审核状态"]),
        createdAt: fields["创建时间"] || ""
      };
    });
    const audit = calculateShadowAudit(routes, this.config.routing?.shadowAcceptance || {});
    const reviewers = selectReviewerOpenIds([...this.memberDirectory.values()]);
    const pending = pendingShadowAuditReviewers(audit, this.shadowAcceptanceState, reviewers);
    let notificationsSent = 0;
    for (const openId of pending.reviewerIds) {
      try {
        const text = formatShadowAuditNotification(audit, pending.kind, this.config.routing?.reviewUrl || "");
        this.lark.sendPrivateText(
          openId,
          text,
          `shadow-acceptance-${pending.key}-${openId}`
        );
        this.shadowAcceptanceState = markShadowAuditReviewerNotified(
          this.shadowAcceptanceState,
          pending.key,
          openId
        );
        notificationsSent += 1;
      } catch (error) {
        console.error(`[agent] 影子验收状态私聊失败 ${openId}`, error.message);
      }
    }
    this.shadowAcceptanceState = {
      ...this.shadowAcceptanceState,
      lastAudit: {
        ...audit,
        checkedAt: new Date().toISOString()
      }
    };
    saveShadowAcceptanceState(this.shadowAcceptanceStateFile, this.shadowAcceptanceState);
    return { audit, notificationsSent };
  }

  async sendRouteReviewDigests() {
    if (!this.config.tables.messageRoutes) return { digestsSent: 0, routesNotified: 0 };
    await this.reconcileDuplicatePendingRoutes();
    const output = this.lark.listRecords(this.config.tables.messageRoutes, [
      "内部路由ID", "正式项目名称", "审核状态", "已通知负责人ID"
    ]);
    const rowByRouteId = new Map();
    const pending = [];
    for (const record of recordsFrom(output)) {
      const fields = fieldsFrom(record);
      const routeId = String(fields["内部路由ID"] || "");
      if (!routeId) continue;
      rowByRouteId.set(routeId, { recordId: recordIdFrom(record), fields });
      pending.push({
        routeId,
        projectName: String(fields["正式项目名称"] || ""),
        status: selectValue(fields["审核状态"]),
        notifiedReviewerIds: String(fields["已通知负责人ID"] || "")
      });
    }
    const reviewers = selectReviewerOpenIds([...this.memberDirectory.values()]);
    const reviewUrl = this.config.routing?.reviewUrl || "";
    const digests = buildReviewerDigests(pending, reviewers, reviewUrl);
    const updates = {};
    let digestsSent = 0;
    const notifiedRouteIds = new Set();
    const period = Math.floor(Date.now() / (2 * 60 * 60 * 1000));
    for (const digest of digests) {
      try {
        this.lark.sendPrivateText(digest.openId, digest.text, `route-review-${digest.openId}-${period}`);
        digestsSent += 1;
        for (const routeId of digest.routeIds) {
          notifiedRouteIds.add(routeId);
          const current = rowByRouteId.get(routeId);
          if (!current?.recordId) continue;
          const notified = parseReviewerIds(current.fields["已通知负责人ID"]);
          if (!notified.includes(digest.openId)) notified.push(digest.openId);
          updates[current.recordId] = {
            "已通知负责人ID": parseReviewerIds(notified).join(","),
            "通知状态": reviewers.every((id) => notified.includes(id)) ? "已通知" : "部分通知",
            "最近通知时间": toFeishuDate()
          };
        }
      } catch (error) {
        console.error(`[agent] 路由审核摘要私聊失败 ${digest.openId}`, error.message);
      }
    }
    this.lark.updateRecords(this.config.tables.messageRoutes, updates);
    return { digestsSent, routesNotified: notifiedRouteIds.size };
  }

  async reconcileDuplicatePendingRoutes() {
    if (!this.config.tables.messageRoutes) return;
    const indexOutput = this.lark.listRecords(this.config.tables.messageIndex, ["消息ID"]);
    const validMessageIds = new Set(recordsFrom(indexOutput)
      .map((record) => String(fieldsFrom(record)["消息ID"] || "").trim())
      .filter(Boolean));
    const output = this.lark.listRecords(this.config.tables.messageRoutes, [
      "内部路由ID", "消息ID", "正式项目名称", "归属依据", "审核状态"
    ]);
    const recordByRouteId = new Map();
    const routes = [];
    for (const record of recordsFrom(output)) {
      const fields = fieldsFrom(record);
      const route = {
        routeId: String(fields["内部路由ID"] || ""),
        messageId: String(fields["消息ID"] || ""),
        projectName: String(fields["正式项目名称"] || ""),
        basis: String(fields["归属依据"] || ""),
        reviewStatus: selectValue(fields["审核状态"])
      };
      if (!route.routeId) continue;
      routes.push(route);
      recordByRouteId.set(route.routeId, { recordId: recordIdFrom(record), fields });
    }
    const duplicateIds = duplicateUnresolvedRouteIds(routes);
    const invalidIds = invalidSemanticRouteIds(routes, validMessageIds);
    const rejectedIds = [...new Set([...duplicateIds, ...invalidIds])];
    const invalidSet = new Set(invalidIds);
    const updates = {};
    for (const routeId of rejectedIds) {
      const current = recordByRouteId.get(routeId);
      if (!current?.recordId) continue;
      updates[current.recordId] = {
        "审核状态": "已驳回",
        "归属依据": `${String(current.fields["归属依据"] || "")}\n${invalidSet.has(routeId)
          ? "系统校验：模型返回的消息 ID 不存在，已拒绝进入审核。"
          : "系统去重：保留同消息的基础待确认路由。"}`,
        "通知状态": "已通知"
      };
    }
    this.lark.updateRecords(this.config.tables.messageRoutes, updates);
    if (rejectedIds.length) console.log(`[agent] 已标记 ${rejectedIds.length} 条无效或重复语义路由`);
  }

  scheduleBatchRetry(batch, batchId, delayMs) {
    const previous = this.retryTimers.get(batchId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.retryTimers.delete(batchId);
      batch.retryAt = 0;
      this.pendingBatchStore.save(batch);
      this.flushBatch(batch, "失败恢复").catch((retryError) => console.error("[agent] 批次重试失败", retryError.message));
    }, Math.max(Number(delayMs) || 0, 0));
    this.retryTimers.set(batchId, timer);
  }

  async flushBatch(batch, source = "实时消息") {
    if (!batch || !batch.messages.length) return;
    if (batch.retryAt && batch.retryAt > Date.now()) return;
    const messageIds = batch.messages.map((message) => message.message_id);
    const batchId = batch.batchId || buildBatchId({ chatId: batch.mapping.chatId, source, messageIds });
    batch.batchId = batchId;
    batch.source = batch.source || source;
    if (isBatchAlreadyProcessed(batch, this.processed)) {
      this.writeBatchState(batch, batchId, batch.source, {
        status: "成功",
        stage: "已由重叠批次完成",
        attempt: batch.retryAttempt || 0
      });
      this.writeMessageIndexes(batch, batchId, {
        status: "成功",
        stage: "已由重叠批次完成",
        attempt: batch.retryAttempt || 0
      });
      this.pendingBatchStore.remove(batchId);
      if (this.batches.get(batch.mapping.chatId) === batch) this.batches.delete(batch.mapping.chatId);
      const retryTimer = this.retryTimers.get(batchId);
      if (retryTimer) clearTimeout(retryTimer);
      this.retryTimers.delete(batchId);
      for (const messageId of messageIds) this.inFlight.delete(messageId);
      return;
    }
    this.pendingBatchStore.save(batch);
    const attempt = Number(batch.retryAttempt || 0) + 1;
    try {
      this.writeMessageIndexes(batch, batchId, { status: "待处理", stage: "等待分析", attempt: batch.retryAttempt || 0 });
      this.writeBatchState(batch, batchId, source, { status: "待处理", stage: "等待分析", attempt: batch.retryAttempt || 0 });
      await runReliableOperation({
        batchId,
        attempt,
        operation: async () => {
          await this.routeBatch(batch, batchId);
          await this.flushBatchCore(batch, source);
        },
        onTransition: async (state) => {
          const stage = state.status === "处理中" ? "模型分析与写入" : state.status === "成功" ? "已完成" : "失败处理";
          this.writeBatchState(batch, batchId, source, { ...state, stage });
          this.writeMessageIndexes(batch, batchId, { ...state, stage });
        }
      });
      if (this.batches.get(batch.mapping.chatId) === batch) this.batches.delete(batch.mapping.chatId);
      this.pendingBatchStore.remove(batchId);
      for (const messageId of messageIds) {
        this.inFlight.delete(messageId);
        this.processed.add(messageId);
      }
      while (this.processed.size > 10000) this.processed.delete(this.processed.values().next().value);
      this.saveProcessedIds();
      await this.reconcileProcessedPendingBatches(batchId);
    } catch (error) {
      batch.retryAttempt = attempt;
      const delay = retryDelayMs(attempt);
      if (delay !== null) {
        batch.retryAt = Date.now() + delay;
        this.pendingBatchStore.save(batch);
        this.scheduleBatchRetry(batch, batchId, delay);
      } else {
        if (this.batches.get(batch.mapping.chatId) === batch) this.batches.delete(batch.mapping.chatId);
        for (const messageId of messageIds) this.inFlight.delete(messageId);
      }
      this.lastRuntimeError = String(error.message || error).slice(0, 1000);
      this.lastRuntimeErrorAt = Date.now();
      const currentHealth = this.groupHealth.get(batch.mapping.chatId) || {};
      this.touchGroupHealth(batch.mapping.chatId, {
        consecutiveFailures: Number(currentHealth.consecutiveFailures || 0) + 1,
        lastError: this.lastRuntimeError,
        lastErrorAt: this.lastRuntimeErrorAt
      });
      this.recordRuntimeEvent({
        type: delay ? "分析失败" : "批次永久失败",
        severity: delay ? "警告" : "高",
        success: false,
        purpose: "批次分析",
        projectName: batch.mapping.projectName,
        chatId: batch.mapping.chatId,
        batchId,
        errorType: error.name || "Error",
        errorMessage: error.message || String(error)
      });
      throw error;
    }
  }

  async reconcileProcessedPendingBatches(completedBatchId = "") {
    for (const pending of this.pendingBatchStore.list()) {
      if (!pending?.batchId || pending.batchId === completedBatchId) continue;
      if (!isBatchAlreadyProcessed(pending, this.processed)) continue;
      await this.flushBatch(pending, pending.source || "失败恢复");
    }
  }

  async flushBatchCore(batch, source = "实时消息") {
    if (!batch || !batch.messages.length) return;

    const identityContext = this.buildIdentityContext(batch.mapping.projectName, batch.messages);
    const analysis = await this.analyzer.analyze({
      projectName: batch.mapping.projectName,
      chatId: batch.mapping.chatId,
      messages: batch.messages,
      identityContext
    });
    const generatedAt = toFeishuDate();
    const conclusionRows = [];
    const registerConclusion = ({ claimId, level, type, text, reason, sourceMessageIds, subjectIds = [], confidence = 0, needsHumanReview = false, identityRequiresReview = false }) => {
      const evidence = deriveEvidence(sourceMessageIds, batch.messages);
      if (!evidence) return null;
      const normalizedLevel = normalizeClaimLevel(level, "推断");
      const row = {
        "结论ID": claimId,
        "结论层级": normalizedLevel,
        "结论类型": type,
        "结论正文": text,
        "证据说明": reason || "",
        "所属项目": batch.mapping.projectName,
        "观察成员": subjectIds.map((id) => ({ id })),
        "观察成员OpenID": compactIds(subjectIds),
        "来源群ID": batch.mapping.chatId,
        "来源群名称": batch.mapping.chatName,
        "批次ID": batch.batchId || "",
        "来源消息ID": compactIds(evidence.ids),
        "原始消息链接": evidence.links.join("\n"),
        "证据数量": evidence.count,
        "批次数量": 1,
        "证据开始时间": evidence.startedAt ? toFeishuDate(evidence.startedAt) : null,
        "证据结束时间": evidence.endedAt ? toFeishuDate(evidence.endedAt) : null,
        "置信度": confidence,
        "敏感等级": normalizedLevel === "事实" ? "低" : "中",
        "是否需要人工审核": normalizedLevel !== "事实" || needsHumanReview || identityRequiresReview,
        "审核状态": claimReviewStatus(normalizedLevel, { needsHumanReview, identityRequiresReview }),
        "Agent版本": this.config.agentVersion,
        "生成时间": generatedAt
      };
      if (batch.mapping.projectRecordId) row["关联项目"] = [{ id: batch.mapping.projectRecordId }];
      if (!row["观察成员"].length) delete row["观察成员"];
      conclusionRows.push(row);
      return { evidence, level: normalizedLevel, reviewStatus: row["审核状态"] };
    };

    const evidenceRows = analysis.contributions
      .filter((item) => userCell(item.member_open_id))
      .map((item) => {
        const identity = this.resolveIdentity(item.member_open_id, batch.mapping.projectName);
        const factId = buildFactId({
          type: "evidence",
          projectId: batch.mapping.projectRecordId || batch.mapping.projectName,
          subjectId: item.member_open_id,
          sourceMessageIds: item.message_ids,
          content: item.evidence_summary
        });
        const claim = registerConclusion({
          claimId: factId,
          level: item.claim_level,
          type: "贡献",
          text: item.evidence_summary,
          reason: item.evidence_reason,
          sourceMessageIds: item.message_ids,
          subjectIds: [item.member_open_id],
          confidence: item.confidence,
          needsHumanReview: item.needs_human_review,
          identityRequiresReview: identity.requiresReview
        });
        if (!claim) return null;
        return {
          "事实ID": factId,
          "结论ID": factId,
          "结论层级": claim.level,
          "证据标题": `${batch.mapping.projectName}｜${item.contribution_type}｜${item.evidence_summary.slice(0, 30)}`,
          "消息ID": compactIds(item.message_ids),
          "群聊ID": batch.mapping.chatId,
          "消息时间": toFeishuDate(batch.messages[0].create_time),
          "贡献成员": userCell(item.member_open_id),
          "所属项目": batch.mapping.projectName,
          "贡献类型": item.contribution_type,
          "证据摘要": item.evidence_summary,
          "证据说明": item.evidence_reason,
          "原始消息链接": claim.evidence.links.join("\n"),
          "证据数量": claim.evidence.count,
          "证据开始时间": claim.evidence.startedAt ? toFeishuDate(claim.evidence.startedAt) : null,
          "证据结束时间": claim.evidence.endedAt ? toFeishuDate(claim.evidence.endedAt) : null,
          "置信度": item.confidence,
          "审核状态": "待确认",
          "需要人工复核": Boolean(item.needs_human_review || identity.requiresReview),
          "身份状态": identity.status,
          "身份判定说明": identity.note,
          "成员档案记录ID": identity.memberRecordId,
          "项目成员关系记录ID": identity.membershipRecordId,
          "允许进入成员总结": false,
          "Agent版本": this.config.agentVersion
        };
      }).filter(Boolean);
    const newEvidenceRows = this.filterNewRows(
      evidenceRows,
      this.existingRecordKeys(this.config.tables.evidence, "事实ID"),
      "事实ID"
    );
    this.lark.createRecords(this.config.tables.evidence, newEvidenceRows);

    const actionRows = analysis.actions.map((item) => {
      const actionId = buildFactId({
        type: "action",
        projectId: batch.mapping.projectRecordId || batch.mapping.projectName,
        subjectId: item.owner_open_id,
        sourceMessageIds: item.source_message_ids,
        content: item.action
      });
      const claim = registerConclusion({
        claimId: actionId,
        level: item.claim_level,
        type: "行动项",
        text: item.action,
        reason: item.evidence_reason,
        sourceMessageIds: item.source_message_ids,
        subjectIds: item.owner_open_id ? [item.owner_open_id] : [],
        confidence: item.confidence,
        needsHumanReview: item.needs_human_review
      });
      if (!claim) return null;
      const row = {
        "行动ID": actionId,
        "结论ID": actionId,
        "结论层级": claim.level,
        "行动项": item.action,
        "所属项目": batch.mapping.projectName,
        "群聊ID": batch.mapping.chatId,
        "来源消息ID": compactIds(item.source_message_ids),
        "证据说明": item.evidence_reason,
        "原始消息链接": claim.evidence.links.join("\n"),
        "证据数量": claim.evidence.count,
        "证据开始时间": claim.evidence.startedAt ? toFeishuDate(claim.evidence.startedAt) : null,
        "证据结束时间": claim.evidence.endedAt ? toFeishuDate(claim.evidence.endedAt) : null,
        "是否需要人工审核": claim.reviewStatus !== "自动确认",
        "负责人": userCell(item.owner_open_id),
        "状态": "待确认",
        "置信度": item.confidence,
        "生成时间": generatedAt,
        "Agent版本": this.config.agentVersion
      };
      if (item.due_date) row["截止时间"] = item.due_date;
      if (!row["负责人"]) delete row["负责人"];
      return row;
    }).filter(Boolean);
    const newActionRows = this.filterNewRows(
      actionRows,
      this.existingRecordKeys(this.config.tables.actions, "行动ID"),
      "行动ID"
    );
    this.lark.createRecords(this.config.tables.actions, newActionRows);

    const decisionRows = analysis.decisions.map((item) => {
      const decisionId = buildFactId({
        type: "decision",
        projectId: batch.mapping.projectRecordId || batch.mapping.projectName,
        sourceMessageIds: item.source_message_ids,
        content: `${item.title}\n${item.decision}`
      });
      const claim = registerConclusion({
        claimId: decisionId,
        level: item.claim_level,
        type: "决策",
        text: item.decision,
        reason: item.evidence_reason,
        sourceMessageIds: item.source_message_ids,
        subjectIds: item.participant_open_ids,
        confidence: item.confidence,
        needsHumanReview: item.needs_human_review
      });
      if (!claim) return null;
      return {
      "决策ID": decisionId,
      "结论ID": decisionId,
      "结论层级": claim.level,
      "决策标题": item.title,
      "所属项目": batch.mapping.projectName,
      "群聊ID": batch.mapping.chatId,
      "来源消息ID": compactIds(item.source_message_ids),
      "证据说明": item.evidence_reason,
      "原始消息链接": claim.evidence.links.join("\n"),
      "证据数量": claim.evidence.count,
      "证据开始时间": claim.evidence.startedAt ? toFeishuDate(claim.evidence.startedAt) : null,
      "证据结束时间": claim.evidence.endedAt ? toFeishuDate(claim.evidence.endedAt) : null,
      "是否需要人工审核": claim.reviewStatus !== "自动确认",
      "决策内容": item.decision,
      "决策原因": item.rationale,
      "参与成员ID": compactIds(item.participant_open_ids),
      "置信度": item.confidence,
      "审核状态": "待确认",
      "生成时间": generatedAt,
      "Agent版本": this.config.agentVersion
    };
    }).filter(Boolean);
    const newDecisionRows = this.filterNewRows(
      decisionRows,
      this.existingRecordKeys(this.config.tables.decisions, "决策ID"),
      "决策ID"
    );
    this.lark.createRecords(this.config.tables.decisions, newDecisionRows);

    const topicSettings = this.config.topicSnapshots || {};
    const maxTopicSnapshots = Math.max(Number(topicSettings.maxPerBatch) || 3, 0);
    const minTopicMessages = Math.max(Number(topicSettings.minMessageCount) || 2, 1);
    const topicRows = topicSettings.enabled !== false && this.config.tables.topicSnapshots
      ? (analysis.topic_snapshots || [])
        .filter((item) => (item.source_message_ids || []).length >= minTopicMessages)
        .slice(0, maxTopicSnapshots)
        .map((item) => {
          const snapshotId = topicSnapshotId(batch.mapping.chatId, item.source_message_ids, item.title);
          const claim = registerConclusion({
            claimId: snapshotId,
            level: item.claim_level,
            type: "话题快照",
            text: item.one_sentence_summary,
            reason: item.evidence_reason,
            sourceMessageIds: item.source_message_ids,
            subjectIds: item.related_open_ids,
            confidence: item.confidence,
            needsHumanReview: item.needs_human_review
          });
          if (!claim) return null;
          return {
          "快照ID": snapshotId,
          "结论ID": snapshotId,
          "结论层级": claim.level,
          "快照标题": item.title,
          "话题类型": item.topic_type,
          "一句话总结": item.one_sentence_summary,
          "群聊ID": batch.mapping.chatId,
          "群聊名称": batch.mapping.chatName,
          "所属项目": batch.mapping.projectName,
          "明确进展": listText(item.progress_points),
          "当前卡点": listText(item.blockers),
          "待办事项": listText(item.action_items),
          "待确认问题": listText(item.pending_questions),
          "后续建议": listText(item.suggestions),
          "相关成员ID": compactIds(item.related_open_ids),
          "来源消息ID": compactIds(item.source_message_ids),
          "证据说明": item.evidence_reason,
          "原始消息链接": claim.evidence.links.join("\n"),
          "消息数量": item.source_message_ids.length,
          "讨论开始时间": toFeishuDate(batch.messages[0].create_time),
          "讨论结束时间": toFeishuDate(batch.messages.at(-1).create_time),
          "置信度": item.confidence,
          "是否需要人工审核": Boolean(item.needs_human_review),
          "处理状态": "待确认",
          "生成时间": generatedAt,
          "Agent版本": this.config.agentVersion
        };
        }).filter(Boolean)
      : [];
    const newTopicRows = topicRows.length
      ? this.filterNewRows(
        topicRows,
        this.existingRecordKeys(this.config.tables.topicSnapshots, "快照ID"),
        "快照ID"
      )
      : [];
    this.lark.createRecords(this.config.tables.topicSnapshots, newTopicRows);

    const newConclusionRows = this.filterNewRows(
      conclusionRows,
      this.existingRecordKeys(this.config.tables.conclusionLedger, "结论ID"),
      "结论ID"
    );
    this.lark.createRecords(this.config.tables.conclusionLedger, newConclusionRows);

    const draftRows = [];
    const existingDraftKeys = this.existingRecordKeys(this.config.tables.drafts, "草稿ID");
    for (const draft of analysis.document_drafts) {
      const sourceMessageIds = compactIds(draft.source_message_ids);
      const draftId = buildFactId({
        type: "draft",
        projectId: batch.mapping.projectRecordId || batch.mapping.projectName,
        sourceMessageIds: draft.source_message_ids,
        content: `${draft.title}\n${draft.content_xml}`
      });
      if (existingDraftKeys.has(draftId)) continue;
      let documentUrl = "";
      if (this.config.documents.createDraftDocuments && batch.mapping.allowDocumentDrafts) {
        try {
          const document = this.lark.createDraftDocument(
            `${this.config.documents.titlePrefix}${draft.title}`,
            draft.content_xml
          );
          documentUrl = document.url || "";
        } catch (error) {
          console.warn(`[agent] 在线文档创建失败，已保留草稿内容：${error.message.slice(0, 160)}`);
        }
      }
      draftRows.push({
        "草稿ID": draftId,
        "草稿标题": draft.title,
        "文档类型": draft.document_type,
        "所属项目": batch.mapping.projectName,
        "草稿内容": draft.content_xml,
        "来源消息ID": sourceMessageIds,
        "风险级别": draft.risk_level,
        "审核状态": "待审核",
        "草稿文档": documentUrl,
        "生成时间": generatedAt,
        "Agent版本": this.config.agentVersion
      });
      if (draft.document_type === "项目周报") this.lastWeeklyReportAt = Date.now();
      if (draft.document_type === "项目月报") this.lastMonthlyReportAt = Date.now();
      existingDraftKeys.add(draftId);
    }
    this.lark.createRecords(this.config.tables.drafts, draftRows);
    this.lastAnalysisAt = Date.now();
    this.touchGroupHealth(batch.mapping.chatId, {
      lastAnalysisAt: this.lastAnalysisAt,
      consecutiveFailures: 0,
      lastError: ""
    });
    console.log(`[agent] ${source}｜${batch.mapping.projectName}：处理 ${batch.messages.length} 条消息，生成 ${topicRows.length} 条话题快照、${evidenceRows.length} 条贡献证据、${actionRows.length} 个行动项、${draftRows.length} 份草稿`);
  }

  normalizeHistoryMessage(message, chatId) {
    const sender = message.sender && typeof message.sender === "object" ? message.sender : {};
    const senderId = sender.id || sender.open_id || message.sender_id || "";
    const rawContent = message.content ?? "";
    let content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed.text === "string") content = parsed.text;
      else if (typeof parsed.content === "string") content = parsed.content;
    } catch {
      // CLI 已经返回可读文本时无需再次解析。
    }
    return {
      ...message,
      type: "history",
      chat_id: chatId,
      chat_type: "group",
      message_id: message.message_id || message.id || "",
      sender_id: senderId,
      sender_type: message.sender_type || sender.sender_type || sender.type || "user",
      create_time: message.create_time || message.createTime || Date.now(),
      content,
      reply_to: message.reply_to || message.parent_id || ""
    };
  }

  async backfill({ start, end, chatIds = [] }) {
    if (!this.config.history?.enabled) throw new Error("历史消息补读已在配置中禁用");
    await this.refreshRuntimeMappings();

    const configuredChatIds = this.config.history.allowedChatIds || [];
    const requestedChatIds = chatIds.length
      ? chatIds
      : this.config.history.includeAllEnabledChats
        ? [...this.chatMappings.keys()]
        : configuredChatIds;
    const allowed = new Set([...configuredChatIds, ...this.chatMappings.keys()]);
    const requested = new Set(requestedChatIds);
    const mappings = [...this.chatMappings.values()].filter((mapping) => (
      allowed.has(mapping.chatId) && !this.isExcludedChat(mapping.chatId) && requested.has(mapping.chatId)
    ));
    const results = [];
    const idleMs = conversationIdleMs(this.config);

    for (const mapping of mappings) {
      const history = this.lark.listChatMessages(mapping.chatId, {
        start,
        end,
        identity: this.config.history.identity || "user",
        pageSize: this.config.history.pageSize,
        maxPages: this.config.history.maxPages
      });
      const accepted = history.messages
        .map((message) => this.normalizeHistoryMessage(message, mapping.chatId))
        .filter((message) => this.shouldAcceptMessage(message))
        .filter((message) => isMessageAvailableForAnalysis(message, this.processed, this.inFlight))
        .sort((a, b) => messageTimeMs(a) - messageTimeMs(b));

      const rounds = splitConversationRounds(accepted, idleMs);
      for (const messages of rounds) {
        for (const message of messages) this.inFlight.add(message.message_id);
        await this.flushBatch({
          mapping,
          messages,
          firstSeenAt: messageTimeMs(messages[0]),
          lastSeenAt: messageTimeMs(messages[messages.length - 1])
        }, "历史补读");
      }

      results.push({
        chat_id: mapping.chatId,
        chat_name: mapping.chatName,
        project: mapping.projectName,
        fetched: history.messages.length,
        analyzed: accepted.length,
        rounds: rounds.length,
        pages: history.pages,
        truncated: history.truncated
      });
    }

    return { start, end, excluded_chat_ids: this.config.privacy.excludedChatIds || [], groups: results };
  }

  async refreshRuntimeMappings() {
    await Promise.all([this.refreshChatMappings(), this.refreshIdentityMappings()]);
    await this.refreshRoutingCatalog();
  }

  async recoverPendingBatches() {
    this.pendingBatchStore.prune({
      retentionDays: Number(this.config.reliability?.pendingBatchRetentionDays) || 30,
      maxAttempts: Number(this.config.reliability?.maxAttempts) || 5,
    });
    const pending = this.pendingBatchStore.list();
    for (const batch of pending) {
      if (!batch?.messages?.length || !batch?.mapping?.chatId) continue;
      batch.mapping = this.chatMappings.get(batch.mapping.chatId) || batch.mapping;
      const messageIds = batch.messages.map((message) => message.message_id);
      const batchId = batch.batchId || buildBatchId({
        chatId: batch.mapping.chatId,
        source: batch.source || "失败恢复",
        messageIds
      });
      batch.batchId = batchId;
      this.batches.set(batch.mapping.chatId, batch);
      for (const message of batch.messages) this.inFlight.add(message.message_id);
      const remainingDelay = remainingRetryDelayMs(batch.retryAt);
      if (remainingDelay > 0) {
        this.scheduleBatchRetry(batch, batchId, remainingDelay);
      } else {
        batch.retryAt = 0;
        this.pendingBatchStore.save(batch);
        this.flushBatch(batch, "失败恢复").catch((error) => console.error("[agent] 启动恢复批次失败", error.message));
      }
    }
    if (pending.length) console.log(`[agent] 已恢复 ${pending.length} 个待处理批次`);
  }

  async reconcileBaseProcessingState() {
    const batchUpdates = {};
    const batchOutput = this.lark.listRecords(this.config.tables.analysisBatches, [
      "消息ID", "处理状态"
    ]);
    for (const record of recordsFrom(batchOutput)) {
      const fields = fieldsFrom(record);
      if (!shouldReconcileBatchState(fields["消息ID"], selectValue(fields["处理状态"]), this.processed)) continue;
      batchUpdates[recordIdFrom(record)] = {
        "处理状态": "成功",
        "处理阶段": "已由重叠批次完成",
        "错误信息": "",
        "下次重试": null,
        "完成时间": toFeishuDate()
      };
    }
    this.lark.updateRecords(this.config.tables.analysisBatches, batchUpdates);

    const indexUpdates = {};
    const indexOutput = this.lark.listRecords(this.config.tables.messageIndex, [
      "消息ID", "处理状态"
    ]);
    for (const record of recordsFrom(indexOutput)) {
      const fields = fieldsFrom(record);
      const messageId = String(fields["消息ID"] || "").trim();
      if (!messageId || selectValue(fields["处理状态"]) === "成功" || !this.processed.has(messageId)) continue;
      indexUpdates[recordIdFrom(record)] = {
        "处理状态": "成功",
        "处理阶段": "已由重叠批次完成",
        "错误信息": "",
        "最后处理": toFeishuDate()
      };
    }
    this.lark.updateRecords(this.config.tables.messageIndex, indexUpdates);
    if (Object.keys(batchUpdates).length || Object.keys(indexUpdates).length) {
      console.log(`[agent] 已对账 ${Object.keys(batchUpdates).length} 个批次、${Object.keys(indexUpdates).length} 条消息索引`);
    }
  }

  async syncConfirmedAliases() {
    if (!this.config.tables.messageRoutes) return;
    const routeOutput = this.lark.listRecords(this.config.tables.messageRoutes, [
      "候选别名", "候选别名状态", "正式项目名称"
    ]);
    const accepted = [];
    for (const record of recordsFrom(routeOutput)) {
      const fields = fieldsFrom(record);
      if (selectValue(fields["候选别名状态"]) !== "已采纳") continue;
      const alias = String(fields["候选别名"] || "").trim();
      const projectName = String(fields["正式项目名称"] || "").trim();
      if (alias && projectName) accepted.push({ recordId: recordIdFrom(record), alias, projectName });
    }
    if (!accepted.length) return;

    const projectOutput = this.lark.listRecords(this.config.tables.projects, ["项目名称", "项目别名"]);
    const projectUpdates = {};
    const routeUpdates = {};
    for (const record of recordsFrom(projectOutput)) {
      const fields = fieldsFrom(record);
      const projectName = String(fields["项目名称"] || "").trim();
      const additions = accepted.filter((item) => item.projectName === projectName);
      if (!additions.length) continue;
      const aliases = String(fields["项目别名"] || "").split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean);
      for (const item of additions) {
        if (!aliases.includes(item.alias)) aliases.push(item.alias);
        routeUpdates[item.recordId] = { "候选别名状态": "已同步" };
      }
      projectUpdates[recordIdFrom(record)] = { "项目别名": aliases.join("，") };
    }
    this.lark.updateRecords(this.config.tables.projects, projectUpdates);
    this.lark.updateRecords(this.config.tables.messageRoutes, routeUpdates);
    await this.refreshRoutingCatalog();
  }

  async syncEvidenceIdentities() {
    await this.refreshRuntimeMappings();
    const output = this.lark.listRecords(this.config.tables.evidence, [
      "贡献成员",
      "所属项目",
      "身份状态",
      "身份判定说明",
      "成员档案记录ID",
      "项目成员关系记录ID"
    ]);
    const updates = {};
    let scanned = 0;
    let matchedMembers = 0;
    let unresolvedMembers = 0;

    for (const record of recordsFrom(output)) {
      scanned += 1;
      const recordId = recordIdFrom(record);
      const fields = fieldsFrom(record);
      const openId = openIdFromCell(fields["贡献成员"]);
      if (!recordId || !openId) continue;
      const identity = this.resolveIdentity(openId, fields["所属项目"]);
      if (identity.memberRecordId) matchedMembers += 1;
      else unresolvedMembers += 1;

      const next = {
        "身份状态": identity.status,
        "身份判定说明": identity.note,
        "成员档案记录ID": identity.memberRecordId,
        "项目成员关系记录ID": identity.membershipRecordId
      };
      const changed = (
        selectValue(fields["身份状态"]) !== next["身份状态"] ||
        String(fields["身份判定说明"] || "") !== next["身份判定说明"] ||
        String(fields["成员档案记录ID"] || "") !== next["成员档案记录ID"] ||
        String(fields["项目成员关系记录ID"] || "") !== next["项目成员关系记录ID"]
      );
      if (changed) updates[recordId] = next;
    }

    this.lark.updateRecords(this.config.tables.evidence, updates);
    return {
      scanned,
      updated: Object.keys(updates).length,
      matchedMembers,
      unresolvedMembers
    };
  }

  async backfillRecentHistory() {
    const days = Math.max(Number(this.config.history.autoBackfillDays) || 0, 0);
    if (!this.config.history.autoBackfillOnStart || days <= 0) return;
    const end = new Date().toISOString();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const result = await this.backfill({
        start,
        end,
        chatIds: this.config.history.autoBackfillChatIds || []
      });
      const totalFetched = result.groups.reduce((sum, group) => sum + group.fetched, 0);
      const totalAnalyzed = result.groups.reduce((sum, group) => sum + group.analyzed, 0);
      console.log(`[agent] 启动补读完成：读取 ${totalFetched} 条历史消息，分析 ${totalAnalyzed} 条未处理消息`);
    } catch (error) {
      console.error("[agent] 启动自动补读失败", error.message);
    }
  }

  async start() {
    await this.refreshRuntimeMappings();
    let startupComplete = false;
    try {
      this.writeHealthStatus("启动中");
    } catch (error) {
      console.error("[agent] 启动状态写入失败", error.message);
    }
    this.timers.push(setInterval(
      () => {
        try {
          this.writeHealthStatus(startupComplete ? "运行中" : "启动中");
        } catch (error) {
          console.error("[agent] 心跳写入失败", error.message);
        }
      },
      Math.max(Number(this.config.health?.heartbeatMinutes) || 5, 1) * 60 * 1000
    ));

    // Start realtime consumers before slower reconciliation, member sync, and
    // history backfill work. Otherwise a transient Feishu slowdown can leave a
    // live Agent process unable to receive new events for several minutes.
    const messageStream = await this.lark.startMessageStream((event) => this.accept(event));
    let membershipStreams = null;
    try {
      membershipStreams = await this.lark.startEventStreams([
        { eventKey: "im.chat.member.bot.added_v1", onEvent: (event) => this.handleBotAdded(event) },
        { eventKey: "im.chat.member.user.added_v1", onEvent: (event) => this.handleUserMembershipChanged(event, "added") },
        { eventKey: "im.chat.member.user.deleted_v1", onEvent: (event) => this.handleUserMembershipChanged(event, "deleted") }
      ]);
    } catch (error) {
      console.error("[agent] 群成员事件监听未完全启用，将由定时同步兜底", error.message);
    }
    this.stream = {
      stop: () => {
        messageStream.stop();
        membershipStreams?.stop();
      }
    };

    if (this.config.weeklyReview?.enabled) {
      try {
        const [{ fork }, { ReviewWorkerSupervisor }] = await Promise.all([import("node:child_process"), import("./review-worker-supervisor.js")]);
        this.weeklyReviewRuntime = new ReviewWorkerSupervisor({
          spawnWorker: () => fork(new URL("./review-worker.js", import.meta.url), [], {
            cwd: process.cwd(),
            env: { ...process.env, CLOUDAGENT_REVIEW_CONFIG: JSON.stringify(this.config) },
            stdio: ["ignore", "inherit", "inherit", "ipc"],
            windowsHide: true,
          }),
        });
        this.weeklyReviewRuntime.start();
      } catch (error) {
        console.error("[agent] 每周问卷 AI 审核运行时启动失败，不影响群消息监听", error.message);
      }
    }

    const startupMaintenance = (async () => {
      try {
        await this.auditShadowAcceptance();
      } catch (error) {
        console.error("[agent] 启动影子验收审计失败", error.message);
      }
      try {
        await this.reconcileBaseProcessingState();
      } catch (error) {
        console.error("[agent] 启动处理状态对账失败", error.message);
      }
      try {
        await this.reconcileDuplicatePendingRoutes();
      } catch (error) {
        console.error("[agent] 启动路由去重失败", error.message);
        this.timers.push(setTimeout(
          () => this.reconcileDuplicatePendingRoutes().catch((retryError) => {
            console.error("[agent] 启动路由去重延迟重试失败", retryError.message);
          }),
          60 * 1000
        ));
      }
      await this.recoverPendingBatches();
      await this.loadTrackedNotifications();
      await runOptionalStartupStep(
        () => this.syncManagedGroups({ notifyNewMembers: false }),
        (error) => console.error("[agent] 启动群成员同步失败，将由定时同步兜底", error.message)
      );
    })();
    this.timers.push(setInterval(
      () => this.refreshRuntimeMappings().catch((error) => console.error("[agent] 刷新运行配置失败", error)),
      this.config.batch.configRefreshSeconds * 1000
    ));
    this.timers.push(setInterval(
      () => Promise.all([this.generateWeeklyWorkStyleObservations(), this.syncConfirmedEvaluations()])
        .catch((error) => console.error("[agent] 证据治理定时同步失败", error.message)),
      Math.max(Number(this.config.evidenceGovernance?.syncIntervalMinutes) || 60, 5) * 60 * 1000
    ));
    this.timers.push(setInterval(
      () => this.flushDueBatches().catch((error) => console.error("[agent] 定时分析失败", error)),
      this.config.batch.flushIntervalSeconds * 1000
    ));
    this.timers.push(setInterval(
      () => this.syncAllNotificationReads().catch((error) => console.error("[agent] 通知阅读同步失败", error)),
      Math.max(Number(this.config.notifications?.readTracking?.syncIntervalMinutes) || 10, 1) * 60 * 1000
    ));
    this.timers.push(setInterval(
      () => this.syncManagedGroups({ notifyNewMembers: false }).catch((error) => console.error("[agent] 群成员同步失败", error)),
      Math.max(Number(this.config.memberGovernance?.syncIntervalMinutes) || 30, 1) * 60 * 1000
    ));
    this.timers.push(setInterval(
      () => this.sendIncompleteProfileReminders().catch((error) => console.error("[agent] 成员档案提醒失败", error)),
      Math.max(Number(this.config.memberGovernance?.profileReminderIntervalHours) || 24, 1) * 60 * 60 * 1000
    ));
    this.timers.push(setInterval(
      () => this.sendRouteReviewDigests().catch((error) => console.error("[agent] 路由审核摘要失败", error)),
      Math.max(Number(this.config.routing?.reviewDigestHours) || 2, 1) * 60 * 60 * 1000
    ));
    this.timers.push(setInterval(
      () => this.auditShadowAcceptance().catch((error) => console.error("[agent] 影子验收审计失败", error)),
      Math.max(Number(this.config.routing?.shadowAuditHours) || 6, 1) * 60 * 60 * 1000
    ));
    this.timers.push(setInterval(
      () => this.syncConfirmedAliases().catch((error) => console.error("[agent] 项目别名同步失败", error)),
      Math.max(Number(this.config.routing?.aliasSyncMinutes) || 10, 1) * 60 * 1000
    ));
    startupComplete = true;
    try {
      this.writeHealthStatus("运行中");
    } catch (error) {
      console.error("[agent] 启动健康状态同步失败", error.message);
    }
    console.log("[agent] 飞书项目管理 Agent 已开始监听");

    startupMaintenance.then(async () => {
      await this.backfillRecentHistory();
      await this.generateWeeklyWorkStyleObservations();
      await this.syncConfirmedEvaluations();
      console.log("[agent] 启动后台维护完成");
    }).catch((error) => {
      console.error("[agent] 启动后台维护失败，将由定时任务继续恢复", error.message);
    });
  }

  abortStartup() {
    clearRuntimeHandles(this);
  }

  async stop() {
    for (const timer of this.timers) clearInterval(timer);
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const timer of this.notificationIdleTimers.values()) clearTimeout(timer);
    this.notificationIdleTimers.clear();
    for (const chatId of [...this.batches.keys()]) {
      try {
        await this.flushChat(chatId);
      } catch (error) {
        console.error("[agent] 退出前分析失败", error);
      }
    }
    this.stream?.stop();
    try {
      this.writeHealthStatus("已停止");
    } catch (error) {
      console.error("[agent] 停止状态写入失败", error.message);
    }
  }
}
import { buildMessageReviewFields } from "./message-review-display.js";
