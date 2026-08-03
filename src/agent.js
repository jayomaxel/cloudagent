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

export class StudioAgent {
  constructor(config, lark) {
    this.config = config;
    this.lark = lark;
    this.analyzer = new Analyzer(config);
    this.chatMappings = new Map();
    this.memberDirectory = new Map();
    this.projectMemberships = new Map();
    this.batches = new Map();
    this.processedFile = path.resolve(
      config.root,
      config.history?.stateFile || ".data/processed-message-ids.json"
    );
    this.processed = this.loadProcessedIds();
    this.autoEnrollInFlight = new Map();
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
      mappings.set(fields["群聊ID"], {
        chatId: fields["群聊ID"],
        chatName: fields["群聊名称"] || fields["群聊ID"],
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
    if (!this.chatMappings.has(event.chat_id) && !this.isExcludedChat(event.chat_id)) {
      this.ensureAutoChatConfig(event.chat_id, event.chat_name || event.chat_id)
        .then((enabled) => {
          if (enabled) this.accept(event);
        })
        .catch((error) => console.error("[agent] 自动接入新群失败", error.message));
      return;
    }
    if (!this.shouldAccept(event)) return;
    this.processed.add(event.message_id);
    if (this.processed.size > 10000) this.processed.delete(this.processed.values().next().value);

    const mapping = this.chatMappings.get(event.chat_id) || {
      chatId: event.chat_id,
      chatName: event.chat_id,
      projectName: "待归属项目",
      allowDocumentDrafts: false
    };
    try {
      this.handleAutomationCommand(event, mapping);
    } catch (error) {
      console.error("[agent] 飞书任务/日程命令执行失败", error.message);
    }
    this.handleOperationalTracking(event, mapping);
    const batch = this.batches.get(event.chat_id) || {
      mapping,
      messages: [],
      firstSeenAt: Date.now()
    };
    batch.messages.push(event);
    this.batches.set(event.chat_id, batch);
    if (batch.messages.length >= this.config.batch.maxMessages) {
      this.flushChat(event.chat_id).catch((error) => console.error("[agent] 批次分析失败", error));
    }
  }

  async flushDueBatches() {
    const deadline = this.config.batch.windowSeconds * 1000;
    for (const [chatId, batch] of this.batches) {
      if (Date.now() - batch.firstSeenAt >= deadline) await this.flushChat(chatId);
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

  async flushBatch(batch, source = "实时消息") {
    if (!batch || !batch.messages.length) return;
    if (this.batches.get(batch.mapping.chatId) === batch) this.batches.delete(batch.mapping.chatId);

    const identityContext = this.buildIdentityContext(batch.mapping.projectName, batch.messages);
    const analysis = await this.analyzer.analyze({
      projectName: batch.mapping.projectName,
      chatId: batch.mapping.chatId,
      messages: batch.messages,
      identityContext
    });
    const generatedAt = toFeishuDate();

    const evidenceRows = analysis.contributions
      .filter((item) => userCell(item.member_open_id))
      .map((item) => {
        const identity = this.resolveIdentity(item.member_open_id, batch.mapping.projectName);
        return {
          "证据标题": `${batch.mapping.projectName}｜${item.contribution_type}｜${item.evidence_summary.slice(0, 30)}`,
          "消息ID": compactIds(item.message_ids),
          "群聊ID": batch.mapping.chatId,
          "消息时间": toFeishuDate(batch.messages[0].create_time),
          "贡献成员": userCell(item.member_open_id),
          "所属项目": batch.mapping.projectName,
          "贡献类型": item.contribution_type,
          "证据摘要": item.evidence_summary,
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
      });
    const newEvidenceRows = this.filterNewRows(
      evidenceRows,
      this.existingRecordKeys(this.config.tables.evidence, "消息ID"),
      "消息ID"
    );
    this.lark.createRecords(this.config.tables.evidence, newEvidenceRows);

    const actionRows = analysis.actions.map((item) => {
      const row = {
        "行动项": item.action,
        "所属项目": batch.mapping.projectName,
        "群聊ID": batch.mapping.chatId,
        "来源消息ID": compactIds(item.source_message_ids),
        "负责人": userCell(item.owner_open_id),
        "状态": "待确认",
        "置信度": item.confidence,
        "生成时间": generatedAt,
        "Agent版本": this.config.agentVersion
      };
      if (item.due_date) row["截止时间"] = item.due_date;
      if (!row["负责人"]) delete row["负责人"];
      return row;
    });
    const newActionRows = this.filterNewRows(
      actionRows,
      this.existingRecordKeys(this.config.tables.actions, "来源消息ID"),
      "来源消息ID"
    );
    this.lark.createRecords(this.config.tables.actions, newActionRows);

    const decisionRows = analysis.decisions.map((item) => ({
      "决策标题": item.title,
      "所属项目": batch.mapping.projectName,
      "群聊ID": batch.mapping.chatId,
      "来源消息ID": compactIds(item.source_message_ids),
      "决策内容": item.decision,
      "决策原因": item.rationale,
      "参与成员ID": compactIds(item.participant_open_ids),
      "置信度": item.confidence,
      "审核状态": "待确认",
      "生成时间": generatedAt,
      "Agent版本": this.config.agentVersion
    }));
    const newDecisionRows = this.filterNewRows(
      decisionRows,
      this.existingRecordKeys(this.config.tables.decisions, "来源消息ID"),
      "来源消息ID"
    );
    this.lark.createRecords(this.config.tables.decisions, newDecisionRows);

    const draftRows = [];
    const existingDraftKeys = this.existingRecordKeys(this.config.tables.drafts, "来源消息ID");
    for (const draft of analysis.document_drafts) {
      const sourceMessageIds = compactIds(draft.source_message_ids);
      if (sourceMessageIds && existingDraftKeys.has(sourceMessageIds)) continue;
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
      if (sourceMessageIds) existingDraftKeys.add(sourceMessageIds);
    }
    this.lark.createRecords(this.config.tables.drafts, draftRows);
    for (const message of batch.messages) this.processed.add(message.message_id);
    this.saveProcessedIds();
    console.log(`[agent] ${source}｜${batch.mapping.projectName}：处理 ${batch.messages.length} 条消息，生成 ${evidenceRows.length} 条贡献证据、${actionRows.length} 个行动项、${draftRows.length} 份草稿`);
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
    const chunkSize = Math.max(Number(this.config.batch.maxMessages) || 25, 1);

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
        .filter((message) => this.shouldAcceptMessage(message));

      for (let index = 0; index < accepted.length; index += chunkSize) {
        const messages = accepted.slice(index, index + chunkSize);
        await this.flushBatch({ mapping, messages, firstSeenAt: Date.now() }, "历史补读");
      }

      results.push({
        chat_id: mapping.chatId,
        chat_name: mapping.chatName,
        project: mapping.projectName,
        fetched: history.messages.length,
        analyzed: accepted.length,
        pages: history.pages,
        truncated: history.truncated
      });
    }

    return { start, end, excluded_chat_ids: this.config.privacy.excludedChatIds || [], groups: results };
  }

  async refreshRuntimeMappings() {
    await Promise.all([this.refreshChatMappings(), this.refreshIdentityMappings()]);
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
    await this.loadTrackedNotifications();
    await this.syncManagedGroups({ notifyNewMembers: false });
    this.timers.push(setInterval(
      () => this.refreshRuntimeMappings().catch((error) => console.error("[agent] 刷新运行配置失败", error)),
      this.config.batch.configRefreshSeconds * 1000
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
    await this.backfillRecentHistory();
    console.log("[agent] 飞书项目管理 Agent 已开始监听");
  }

  async stop() {
    for (const timer of this.timers) clearInterval(timer);
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
  }
}
