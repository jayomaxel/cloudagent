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
    this.stream = null;
    this.timers = [];
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
        "飞书成员", "姓名", "成长阶段", "成员状态", "年级"
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
        grade: selectValue(fields["年级"])
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
    this.timers.push(setInterval(
      () => this.refreshRuntimeMappings().catch((error) => console.error("[agent] 刷新运行配置失败", error)),
      this.config.batch.configRefreshSeconds * 1000
    ));
    this.timers.push(setInterval(
      () => this.flushDueBatches().catch((error) => console.error("[agent] 定时分析失败", error)),
      this.config.batch.flushIntervalSeconds * 1000
    ));
    const messageStream = await this.lark.startMessageStream((event) => this.accept(event));
    let membershipStream = null;
    try {
      membershipStream = await this.lark.startEventStream(
        "im.chat.member.bot.added_v1",
        (event) => this.handleBotAdded(event)
      );
    } catch (error) {
      console.error("[agent] 入群事件监听未启用，将由首条群消息触发自动接入", error.message);
    }
    this.stream = {
      stop: () => {
        messageStream.stop();
        membershipStream?.stop();
      }
    };
    await this.backfillRecentHistory();
    console.log("[agent] 飞书项目管理 Agent 已开始监听");
  }

  async stop() {
    for (const timer of this.timers) clearInterval(timer);
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
