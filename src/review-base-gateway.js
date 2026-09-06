import { spawnSync } from "node:child_process";
import { larkCliInvocation } from "./lark-cli-process.js";

function parseOutput(stdout) {
  const text = String(stdout || "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error(text.trim() || "飞书 CLI 未返回 JSON");
  const payload = JSON.parse(text.slice(start));
  if (payload.ok === false) throw new Error(payload.error?.message || JSON.stringify(payload.error || payload));
  return payload;
}

export function normalizeBaseRecords(output, requestedFields = []) {
  const data = output?.data || output || {};
  if (Array.isArray(data.records)) return data.records;
  const names = data.fields || requestedFields;
  return (data.data || []).map((row, index) => ({
    record_id: data.record_id_list?.[index],
    fields: Object.fromEntries(names.map((name, column) => [name, row[column]]))
  }));
}

function createdIds(payload) {
  const found = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.record_id === "string") found.push(value.record_id);
    if (typeof value.recordId === "string") found.push(value.recordId);
    for (const item of Object.values(value)) Array.isArray(item) ? item.forEach(walk) : walk(item);
  };
  walk(payload?.data);
  return [...new Set(found)];
}

export class ReviewBaseGateway {
  constructor(config, { spawnImpl = spawnSync, sleepImpl } = {}) {
    this.config = config;
    this.spawnImpl = spawnImpl;
    this.sleepImpl = sleepImpl || ((ms) => {
      if (ms <= 0) return;
      const buffer = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(buffer), 0, 0, ms);
    });
  }

  run(args, { safeRetry = true } = {}) {
    const delays = safeRetry ? (this.config.reliability?.transportRetryDelaysMs || [500, 1500, 5000]) : [];
    let lastError;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      const invocation = larkCliInvocation(this.config.larkCliEntry, [...args, "--format", "json"]);
      const result = this.spawnImpl(invocation.command, invocation.args, {
        cwd: this.config.root || process.cwd(), encoding: "utf8", windowsHide: true, shell: false
      });
      try {
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(result.stderr || result.stdout || `lark-cli exited ${result.status}`);
        return parseOutput(result.stdout);
      } catch (error) {
        lastError = error;
        if (attempt >= delays.length || !/(EOF|ECONNRESET|ETIMEDOUT|timeout|network|socket|temporar|连接|网络)/i.test(String(error.message))) break;
        this.sleepImpl(delays[attempt]);
      }
    }
    throw lastError;
  }

  baseArgs(command, table, extra = []) {
    return ["base", command, "--base-token", this.config.baseToken, "--table-id", table, "--as", "user", ...extra];
  }

  listRecords(table, fields = [], { limit = 10_000, filter = "" } = {}) {
    const records = [];
    let offset = 0;
    while (records.length < limit) {
      const pageSize = Math.min(200, limit - records.length);
      const args = this.baseArgs("+record-list", table, ["--limit", String(pageSize), "--offset", String(offset)]);
      if (filter) args.push("--filter", filter);
      for (const field of fields) args.push("--field-id", field);
      const output = this.run(args);
      const page = normalizeBaseRecords(output, fields);
      records.push(...page);
      const data = output?.data || output || {};
      const hasMore = data.has_more ?? data.hasMore ?? page.length === pageSize;
      if (!hasMore || page.length === 0) break;
      offset += page.length;
    }
    return records.slice(0, limit);
  }

  getRecord(table, recordId) {
    const output = this.run(this.baseArgs("+record-get", table, ["--record-id", recordId]));
    return output.data?.record || output.data;
  }

  createRecords(table, records) {
    if (!records.length) return { recordIds: [], output: null };
    const output = this.run(this.baseArgs("+record-batch-create", table, ["--json", JSON.stringify({ create_records: records })]), { safeRetry: false });
    return { recordIds: createdIds(output), output };
  }

  updateRecords(table, updates) {
    if (!Object.keys(updates).length) return null;
    return this.run(this.baseArgs("+record-batch-update", table, ["--json", JSON.stringify({ update_records: updates })]));
  }

  deleteRecord(table, recordId) {
    return this.run(this.baseArgs("+record-delete", table, ["--record-id", recordId, "--yes"]), { safeRetry: false });
  }

  findByField(table, field, value, fields = [field]) {
    const requestedFields = [...new Set([field, ...fields])];
    const filter = JSON.stringify({ conjunction: "and", conditions: [{ field_name: field, operator: "is", value: [String(value)] }] });
    try {
      return this.listRecords(table, requestedFields, { limit: 2, filter })
        .find((record) => String(record.fields?.[field] || "") === String(value)) || null;
    } catch {
      return this.listRecords(table, requestedFields)
        .find((record) => String(record.fields?.[field] || "") === String(value)) || null;
    }
  }
}
