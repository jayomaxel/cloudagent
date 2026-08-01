import { Analyzer } from "./analyzer.js";

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
  const values = Array.isArray(value) ? value : value ? [value] : [];
  for (const item of values) {
    if (typeof item === "string" && item.startsWith("ou_")) return item;
    const id = item?.id || item?.open_id || item?.user_id;
    if (typeof id === "string" && id.startsWith("ou_")) return id;
  }
  return "";
}

function toFeishuDate(value = Date.now()) {
  const date = new Date(Number(value));
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function userCell(openId) {
  return openId && openId.startsWith("ou_") ? [{ id: openId }] : null;
}

function compactIds(ids) {
  return [...new Set(ids)].join(",").slice(0, 1800);
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
    this.processed = new Set();
    this.stream = null;
    this.timers = [];
  }

  async refreshChatMappings() {
    const output = this.lark.listRecords(this.config.tables.chatConfig, [
      "群聊ID", "群聊名称", "所属项目", "启用分析", "允许文档草稿"
    ]);
    const mappings = new Map();
    for (const record of recordsFrom(output)) {
      const fields = fieldsFrom(record);
      if (!fields["启用分析"] || !fields["群聊ID"]) continue;
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
        stage: fields["成长阶段"] || "",
        status: fields["成员状态"] || "",
        grade: fields["年级"] || ""
      });
    }

    const memberships = new Map();
    for (const record of recordsFrom(membershipOutput)) {
      const fields = fieldsFrom(record);
      const openId = openIdFromCell(fields["成员"]);
      const projectName = String(fields["所属项目"] || "").trim();
      if (!openId || !projectName) continue;
      const item = {
        recordId: recordIdFrom(record),
        openId,
        projectName,
        role: fields["项目角色"] || "",
        memberType: fields["成员类型"] || "工作室成员",
        status: fields["关系状态"] || "待确认",
        joinedAt: fields["加入日期"] || "",
        exitedAt: fields["退出日期"] || ""
      };
      const key = membershipKey(projectName, openId);
      const current = memberships.get(key);
      if (!current || item.status === "活跃") memberships.set(key, item);
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

  shouldAccept(event) {
    if (event.type !== "im.message.receive_v1" || event.chat_type !== "group") return false;
    if (this.config.privacy.ignoreBots && event.sender_type === "bot") return false;
    if (!event.message_id || this.processed.has(event.message_id)) return false;
    if ((event.content || "").trim().length < this.config.privacy.minimumContentLength) return false;
    if (!this.config.privacy.allowAllChats && !this.chatMappings.has(event.chat_id)) return false;
    return true;
  }

  accept(event) {
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
    const batch = this.batches.get(chatId);
    if (!batch || !batch.messages.length) return;
    this.batches.delete(chatId);

    const identityContext = this.buildIdentityContext(batch.mapping.projectName, batch.messages);
    const analysis = await this.analyzer.analyze({
      projectName: batch.mapping.projectName,
      chatId,
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
          "群聊ID": chatId,
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
    this.lark.createRecords(this.config.tables.evidence, evidenceRows);

    const actionRows = analysis.actions.map((item) => {
      const row = {
        "行动项": item.action,
        "所属项目": batch.mapping.projectName,
        "群聊ID": chatId,
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
    this.lark.createRecords(this.config.tables.actions, actionRows);

    const decisionRows = analysis.decisions.map((item) => ({
      "决策标题": item.title,
      "所属项目": batch.mapping.projectName,
      "群聊ID": chatId,
      "来源消息ID": compactIds(item.source_message_ids),
      "决策内容": item.decision,
      "决策原因": item.rationale,
      "参与成员ID": compactIds(item.participant_open_ids),
      "置信度": item.confidence,
      "审核状态": "待确认",
      "生成时间": generatedAt,
      "Agent版本": this.config.agentVersion
    }));
    this.lark.createRecords(this.config.tables.decisions, decisionRows);

    const draftRows = [];
    for (const draft of analysis.document_drafts) {
      let documentUrl = "";
      if (this.config.documents.createDraftDocuments && batch.mapping.allowDocumentDrafts) {
        const document = this.lark.createDraftDocument(
          `${this.config.documents.titlePrefix}${draft.title}`,
          draft.content_xml
        );
        documentUrl = document.url || "";
      }
      draftRows.push({
        "草稿标题": draft.title,
        "文档类型": draft.document_type,
        "所属项目": batch.mapping.projectName,
        "草稿内容": draft.content_xml,
        "来源消息ID": compactIds(draft.source_message_ids),
        "风险级别": draft.risk_level,
        "审核状态": "待审核",
        "草稿文档": documentUrl,
        "生成时间": generatedAt,
        "Agent版本": this.config.agentVersion
      });
    }
    this.lark.createRecords(this.config.tables.drafts, draftRows);
    console.log(`[agent] ${batch.mapping.projectName}：处理 ${batch.messages.length} 条消息，生成 ${evidenceRows.length} 条贡献证据、${actionRows.length} 个行动项、${draftRows.length} 份草稿`);
  }

  async refreshRuntimeMappings() {
    await Promise.all([this.refreshChatMappings(), this.refreshIdentityMappings()]);
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
    this.stream = await this.lark.startMessageStream((event) => this.accept(event));
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
