import { buildWriteOperationId, REVIEW_STATUS } from "./review-policy.js";

function nowText() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" }).format(new Date());
}

function userCell(openId) {
  return openId ? [{ id: openId }] : [];
}

function userCells(openIds) {
  return [...new Set(openIds.filter(Boolean))].map((id) => ({ id }));
}

export function assertAcceptedFacts(acceptedFacts, { humanOverride = false } = {}) {
  if (!humanOverride && (!Array.isArray(acceptedFacts) || acceptedFacts.length === 0)) {
    throw new Error("At least one accepted fact is required for automatic write");
  }
}

export function isRollbackSnapshotSafe(afterSnapshot, currentFields) {
  for (const [field, expected] of Object.entries(afterSnapshot || {})) {
    if (expected !== null && typeof expected === "object") continue;
    if ((currentFields || {})[field] !== expected) return false;
  }
  return true;
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

const CONTRIBUTION_TYPE_MAP = {
  技术实现: "项目推进",
  项目推进: "项目推进",
  产品需求: "项目推进",
  协作支持: "帮助成员",
  知识沉淀: "教程文档",
  风险担当: "风险担当",
  组织贡献: "公共维护"
};

export class AutoWriteService {
  constructor({ gateway, config }) {
    this.gateway = gateway;
    this.config = config;
  }

  table(key, fallback) {
    return this.config.tables?.[key] || fallback;
  }

  ledger(operationId) {
    return this.gateway.findByField(this.table("autoWriteLog", "Agent 自动写入日志"), "操作ID", operationId, ["操作ID", "执行状态", "目标表", "目标记录ID", "写入前快照", "写入后快照", "操作类型"]);
  }

  beginLedger({ operationId, reviewId, targetTable, targetRecordId = "", action, before, after }) {
    const existing = this.ledger(operationId);
    if (existing) return existing;
    this.gateway.createRecords(this.table("autoWriteLog", "Agent 自动写入日志"), [{
      "操作ID": operationId,
      "审核ID": reviewId,
      "目标表": targetTable,
      "目标记录ID": targetRecordId,
      "操作类型": action,
      "写入前快照": safeJson(before),
      "写入后快照": safeJson(after),
      "执行状态": "待执行",
      "创建时间": nowText(),
      "Agent版本": this.config.agentVersion
    }]);
    return this.ledger(operationId);
  }

  finishLedger(operationId, fields) {
    const ledger = this.ledger(operationId);
    if (!ledger?.record_id) throw new Error(`找不到写入日志 ${operationId}`);
    this.gateway.updateRecords(this.table("autoWriteLog", "Agent 自动写入日志"), {
      [ledger.record_id]: { ...fields, "完成时间": nowText() }
    });
  }

  applyUpdate({ reviewId, targetTable, targetRecordId, before, after, suffix }) {
    const operationId = buildWriteOperationId(reviewId, `${targetTable}:${targetRecordId}:${suffix}`, "更新");
    const existing = this.ledger(operationId);
    if (existing?.fields?.["执行状态"] === "成功") return operationId;
    this.beginLedger({ operationId, reviewId, targetTable, targetRecordId, action: "更新", before, after });
    try {
      this.gateway.updateRecords(targetTable, { [targetRecordId]: after });
      this.finishLedger(operationId, { "执行状态": "成功", "目标记录ID": targetRecordId, "错误信息": "" });
      return operationId;
    } catch (error) {
      this.finishLedger(operationId, { "执行状态": "失败", "错误信息": String(error.message || error).slice(0, 1000) });
      throw error;
    }
  }

  applyCreate({ reviewId, targetTable, record, suffix, idempotencyField = "", idempotencyValue = "" }) {
    const operationId = buildWriteOperationId(reviewId, `${targetTable}:${suffix}`, "新建");
    const existing = this.ledger(operationId);
    if (existing?.fields?.["执行状态"] === "成功") return operationId;
    this.beginLedger({ operationId, reviewId, targetTable, action: "新建", before: null, after: record });
    try {
      if (idempotencyField && idempotencyValue) {
        const target = this.gateway.findByField(targetTable, idempotencyField, idempotencyValue, [idempotencyField]);
        if (target?.record_id) {
          this.finishLedger(operationId, { "执行状态": "成功", "目标记录ID": target.record_id, "错误信息": "" });
          return operationId;
        }
      }
      const result = this.gateway.createRecords(targetTable, [record]);
      let targetRecordId = result.recordIds[0] || "";
      if (!targetRecordId && idempotencyField && idempotencyValue) {
        targetRecordId = this.gateway.findByField(targetTable, idempotencyField, idempotencyValue, [idempotencyField])?.record_id || "";
      }
      if (!targetRecordId) throw new Error("目标记录已创建但无法确认记录 ID，已停止后续写入");
      this.finishLedger(operationId, { "执行状态": "成功", "目标记录ID": targetRecordId, "错误信息": "" });
      return operationId;
    } catch (error) {
      this.finishLedger(operationId, { "执行状态": "失败", "错误信息": String(error.message || error).slice(0, 1000) });
      throw error;
    }
  }

  applyVerifiedReview({ candidate, extraction, verification, outcome, humanOverride = false, contributors = [] }) {
    if (!humanOverride && (outcome?.status !== REVIEW_STATUS.AUTO || !outcome?.allowFormalWrite)) return [];
    const operations = [];
    const accepted = (verification.accepted_fact_indexes || []).map((index) => extraction.facts?.[index]).filter(Boolean);
    assertAcceptedFacts(accepted, { humanOverride });
    const summary = accepted.map((fact) => fact.text).join("；") || extraction.summary;

    const contributorList = [{ openId: candidate.memberOpenId, memberRecordId: candidate.memberRecordId, name: candidate.memberName }, ...contributors]
      .filter((item, index, list) => item.openId && list.findIndex((candidateItem) => candidateItem.openId === item.openId) === index);

    for (const contributor of contributorList) if (contributor.memberRecordId && summary) {
      const memberTable = this.table("members", "成员档案");
      const current = this.gateway.getRecord(memberTable, contributor.memberRecordId);
      const beforeText = String(current?.fields?.["成长记录"] || "");
      const marker = `[${candidate.weekKey}][AI已复核][${candidate.factId}]`;
      if (!beforeText.includes(marker)) {
        const afterText = [beforeText, `${marker}\n${summary}`].filter(Boolean).join("\n\n");
        operations.push(this.applyUpdate({
          reviewId: candidate.reviewId,
          targetTable: memberTable,
          targetRecordId: contributor.memberRecordId,
          before: { "成长记录": beforeText },
          after: { "成长记录": afterText },
          suffix: `成员成长记录:${contributor.openId}`
        }));
      }
    }

    const evidenceTable = this.table("evidence", "Agent 贡献证据");
    if (!this.gateway.findByField(evidenceTable, "事实ID", candidate.factId, ["事实ID"])) {
      const contributionType = accepted.find((fact) => fact.contribution_type)?.contribution_type || "项目推进";
      operations.push(this.applyCreate({
        reviewId: candidate.reviewId,
        targetTable: evidenceTable,
        suffix: `证据:${candidate.factId}`,
        idempotencyField: "事实ID",
        idempotencyValue: candidate.factId,
        record: {
          "证据标题": `${candidate.memberName || candidate.memberOpenId} ${candidate.periodStart} 周成长证据`,
          "事实ID": candidate.factId,
          "结论层级": "事实",
          "证据说明": verification.rationale,
          "证据摘要": summary,
          "贡献成员": userCells(contributorList.map((item) => item.openId)),
          "所属项目": candidate.projectName,
          "贡献类型": contributionType,
          "原始消息链接": candidate.links.join("\n"),
          "证据数量": candidate.independentSources,
          "证据开始时间": candidate.periodStart,
          "证据结束时间": candidate.periodEnd,
          "审核状态": "已确认",
          "需要人工复核": false,
          "允许进入成员总结": true,
          "成员档案记录ID": candidate.memberRecordId,
          "Agent版本": this.config.agentVersion
        }
      }));
    }

    if (extraction.contribution_claim && candidate.memberOpenId) {
      const contributionTable = this.table("communityContributions", "社区贡献");
      const proof = candidate.links[0] || "";
      operations.push(this.applyCreate({
        reviewId: candidate.reviewId,
        targetTable: contributionTable,
        suffix: `社区贡献:${candidate.factId}`,
        idempotencyField: "贡献标题",
        idempotencyValue: `${candidate.memberName || "成员"} ${candidate.periodStart} 周贡献`,
        record: {
          "贡献标题": `${candidate.memberName || "成员"} ${candidate.periodStart} 周贡献`,
          "关联项目": candidate.projectName,
          "贡献成员": userCells(contributorList.map((item) => item.openId)),
          "贡献类型": CONTRIBUTION_TYPE_MAP[accepted.find((fact) => fact.contribution_type)?.contribution_type] || "项目推进",
          "贡献说明": summary,
          "证明链接": proof,
          "贡献日期": candidate.periodEnd,
          "影响范围": candidate.projectName ? "项目组" : "个人",
          "已确认": true
        }
      }));
    }
    return operations;
  }

  rollbackWrite(operationId) {
    const preview = this.previewRollback(operationId);
    if (!preview.safe) throw new Error(`目标记录已发生变化，拒绝回滚：${preview.conflicts.join("、")}`);
    const ledger = this.ledger(operationId);
    if (!ledger) throw new Error(`找不到操作 ${operationId}`);
    const fields = ledger.fields || {};
    if (fields["执行状态"] === "已回滚") throw new Error("该操作已经回滚");
    if (fields["执行状态"] !== "成功") throw new Error("只有成功操作可以回滚");
    const targetTable = fields["目标表"];
    const targetRecordId = fields["目标记录ID"];
    if (!targetTable || !targetRecordId) throw new Error("写入日志缺少目标记录");
    if (fields["操作类型"] === "更新") {
      this.gateway.updateRecords(targetTable, { [targetRecordId]: JSON.parse(fields["写入前快照"] || "{}") });
    } else if (fields["操作类型"] === "新建") {
      this.gateway.deleteRecord(targetTable, targetRecordId);
    } else {
      throw new Error(`不支持的回滚类型：${fields["操作类型"]}`);
    }
    this.gateway.updateRecords(this.table("autoWriteLog", "Agent 自动写入日志"), {
      [ledger.record_id]: { "执行状态": "已回滚", "回滚时间": nowText(), "错误信息": "" }
    });
    return { operationId, targetTable, targetRecordId, rolledBack: true };
  }

  previewRollback(operationId) {
    const ledger = this.ledger(operationId);
    if (!ledger) throw new Error(`找不到操作 ${operationId}`);
    const fields = ledger.fields || {};
    if (fields["执行状态"] === "已回滚") throw new Error("该操作已经回滚");
    if (fields["执行状态"] !== "成功") throw new Error("只有成功操作可以回滚");
    const targetTable = fields["目标表"];
    const targetRecordId = fields["目标记录ID"];
    if (!targetTable || !targetRecordId) throw new Error("写入日志缺少目标记录");
    const current = this.gateway.getRecord(targetTable, targetRecordId);
    const after = JSON.parse(fields["写入后快照"] || "{}");
    const safe = isRollbackSnapshotSafe(after, current?.fields || current || {});
    const conflicts = safe ? [] : Object.keys(after).filter((field) => {
      const expected = after[field];
      return (expected === null || typeof expected !== "object") && (current?.fields || current || {})[field] !== expected;
    });
    return { operationId, targetTable, targetRecordId, action: fields["操作类型"], safe, conflicts, affectedFields: Object.keys(after) };
  }
}
