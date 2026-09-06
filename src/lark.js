import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { larkCliInvocation } from "./lark-cli-process.js";

const DEFAULT_TRANSPORT_RETRY_DELAYS_MS = [500, 1500, 5000];
const DEFAULT_EVENT_RESTART_DELAYS_MS = [1000, 5000, 15000, 60000];

function failureText(result, error = null) {
  return [error?.message, result?.error?.message, result?.stderr, result?.stdout]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function failureEnvelope(text) {
  const start = String(text || "").indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(String(text).slice(start));
  } catch {
    return null;
  }
}

export function isRetryableTransportFailure(value) {
  const text = typeof value === "string" ? value : failureText(value || {});
  const envelope = failureEnvelope(text);
  const error = envelope?.error || envelope;
  if (error?.type === "network" && error?.subtype === "transport") return true;
  return /\bEOF\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|connection reset/i.test(text);
}

export function isSafeToRetryCliCommand(args = []) {
  const operation = args.slice(0, 3).join(" ");
  const shortOperation = args.slice(0, 2).join(" ");
  const readOperations = new Set([
    "auth status",
    "base +record-list",
    "im +chat-messages-list",
    "im +chat-members-list",
    "im chats get",
    "im messages read_users"
  ]);
  if (readOperations.has(operation) || readOperations.has(shortOperation)) return true;
  if (shortOperation === "base +record-batch-update") return true;
  if (shortOperation === "base +record-upsert") return true;
  if (shortOperation === "im +messages-send" && args.includes("--idempotency-key")) return true;
  if (shortOperation === "task +create" && args.includes("--idempotency-key")) return true;
  return false;
}

export function eventRestartDelayMs(attempt, delays = DEFAULT_EVENT_RESTART_DELAYS_MS) {
  const normalized = Array.isArray(delays) && delays.length ? delays : DEFAULT_EVENT_RESTART_DELAYS_MS;
  return Math.max(0, Number(normalized[Math.min(Math.max(Number(attempt) || 0, 0), normalized.length - 1)]) || 0);
}

function sleepSync(delayMs) {
  if (delayMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function parseJsonOutput(stdout) {
  const text = stdout.trim();
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`飞书 CLI 未返回 JSON：${text}`);
  return JSON.parse(text.slice(start));
}

function stripTitle(xml) {
  return xml.replace(/<title>[\s\S]*?<\/title>/gi, "").trim();
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function recordsFromOutput(output) {
  const payload = output?.data || {};
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.fields) && Array.isArray(payload.data)) {
    return payload.data.map((row, index) => ({
      record_id: payload.record_id_list?.[index] || "",
      fields: Object.fromEntries(payload.fields.map((field, fieldIndex) => [field, row[fieldIndex]]))
    }));
  }
  return [];
}

export function cliJsonArgs(args, { supportsFormat = true } = {}) {
  if (!supportsFormat || args.includes("--format") || args.includes("--json")) return args;
  return [...args, "--format", "json"];
}

export class LarkClient {
  constructor(config, options = {}) {
    this.config = config;
    this.entry = config.larkCliEntry;
    this.baseToken = config.baseToken;
    this.spawnSyncImpl = options.spawnSync || spawnSync;
    this.spawnImpl = options.spawn || spawn;
    this.sleepImpl = options.sleep || sleepSync;
  }

  runJson(args, options = {}) {
    const finalArgs = cliJsonArgs(args, options);
    const configuredDelays = this.config.reliability?.transportRetryDelaysMs;
    const retryDelays = Array.isArray(configuredDelays) && configuredDelays.length
      ? configuredDelays.map((value) => Math.max(0, Number(value) || 0))
      : DEFAULT_TRANSPORT_RETRY_DELAYS_MS;
    const retryTransport = options.retryTransport ?? isSafeToRetryCliCommand(finalArgs);
    const maxAttempts = retryTransport ? retryDelays.length + 1 : 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const invocation = larkCliInvocation(this.entry, finalArgs);
      const result = this.spawnSyncImpl(invocation.command, invocation.args, {
        cwd: this.config.root,
        encoding: "utf8",
        windowsHide: true
      });
      try {
        if (result.status !== 0) throw new Error(failureText(result));
        const output = parseJsonOutput(result.stdout);
        if (output.ok === false) throw new Error(JSON.stringify(output.error || output));
        return output;
      } catch (error) {
        lastError = error;
        const retryable = retryTransport && isRetryableTransportFailure(failureText(result, error));
        if (!retryable || attempt >= maxAttempts - 1) throw error;
        const delayMs = retryDelays[attempt] || 0;
        const operation = finalArgs.slice(0, 3).join(" ");
        console.warn(`[lark] ${operation} 遇到临时网络错误，${delayMs}ms 后重试（${attempt + 2}/${maxAttempts}）`);
        this.sleepImpl(delayMs);
      }
    }
    throw lastError || new Error("飞书 CLI 调用失败");
  }

  authStatus() {
    return this.runJson(["auth", "status"], { supportsFormat: false });
  }

  listRecords(tableName, fields = [], options = {}) {
    const pageSize = Math.min(Math.max(Number(options.pageSize) || 200, 1), 200);
    const collected = [];
    let offset = 0;
    let firstOutput = null;

    while (true) {
      const args = [
        "base", "+record-list",
        "--base-token", this.baseToken,
        "--table-id", tableName,
        "--offset", String(offset),
        "--limit", String(pageSize),
        "--as", "user"
      ];
      for (const field of fields) args.push("--field-id", field);
      if (options.filter) args.push("--filter-json", JSON.stringify(options.filter));
      if (options.sort) args.push("--sort-json", JSON.stringify(options.sort));
      const output = this.runJson(args);
      if (!firstOutput) firstOutput = output;
      const pageRecords = recordsFromOutput(output);
      collected.push(...pageRecords);
      const payload = output.data || {};
      if (!payload.has_more || !pageRecords.length) break;
      offset += pageRecords.length;
    }

    const selectedFields = fields.length
      ? fields
      : firstOutput?.data?.fields || [];
    return {
      ok: true,
      identity: firstOutput?.identity || "user",
      data: {
        fields: selectedFields,
        data: collected.map((record) => selectedFields.map((field) => record.fields?.[field])),
        record_id_list: collected.map((record) => record.record_id || record.id || ""),
        has_more: false
      }
    };
  }

  findRecordByField(tableName, fieldName, value, fields = []) {
    const output = this.listRecords(
      tableName,
      [...new Set([fieldName, ...fields])],
      {
        pageSize: 2,
        filter: { logic: "and", conditions: [[fieldName, "==", String(value)]] }
      }
    );
    return recordsFromOutput(output)[0] || null;
  }

  listChatMessages(chatId, options = {}) {
    const start = options.start || "";
    const end = options.end || "";
    const pageSize = Math.min(Math.max(Number(options.pageSize) || 50, 1), 50);
    const maxPages = Math.max(Number(options.maxPages) || 200, 1);
    const messages = [];
    let pageToken = "";
    let pages = 0;
    let hasMore = false;

    while (pages < maxPages) {
      const args = [
        "im", "+chat-messages-list",
        "--as", options.identity || "user",
        "--chat-id", chatId,
        "--order", "asc",
        "--page-size", String(pageSize),
        "--no-reactions"
      ];
      if (start) args.push("--start", start);
      if (end) args.push("--end", end);
      if (pageToken) args.push("--page-token", pageToken);

      const output = this.runJson(args);
      const payload = output.data ?? output;
      const pageMessages = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.messages)
          ? payload.messages
          : Array.isArray(payload.items)
            ? payload.items
            : [];
      messages.push(...pageMessages);
      pages += 1;
      hasMore = Boolean(payload.has_more ?? output.has_more);
      const nextPageToken = payload.page_token || output.page_token || "";
      if (!hasMore || !nextPageToken) break;
      pageToken = nextPageToken;
    }

    return { messages, pages, truncated: hasMore };
  }

  listChatMemberUsers(chatId) {
    const output = this.runJson([
      "im", "+chat-members-list",
      "--chat-id", chatId,
      "--member-types", "user",
      "--page-all",
      "--as", "bot"
    ]);
    const payload = output.data ?? output;
    const users = Array.isArray(payload.users)
      ? payload.users
      : Array.isArray(payload.items)
        ? payload.items
        : Array.isArray(payload.members)
          ? payload.members
          : [];
    return users
      .map((user) => ({
        id: user.id || user.open_id || user.user_id || user.member_id || "",
        name: user.name || user.display_name || user.member_name || ""
      }))
      .filter((user) => user.id.startsWith("ou_"));
  }

  readMessageUsers(messageId) {
    const output = this.runJson([
      "im", "messages", "read_users",
      "--as", "bot",
      "--message-id", messageId,
      "--user-id-type", "open_id",
      "--page-size", "100",
      "--page-all"
    ]);
    const payload = output.data ?? output;
    const items = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.data)
        ? payload.data
        : [];
    return items
      .map((item) => ({
        id: item.user_id || item.open_id || item.id || "",
        readAt: item.timestamp || ""
      }))
      .filter((item) => item.id.startsWith("ou_"));
  }

  getChat(chatId) {
    return this.runJson([
      "im", "chats", "get",
      "--chat-id", chatId,
      "--as", "bot"
    ]);
  }

  createRecords(tableName, records) {
    if (!records.length) return null;
    const outputs = [];
    for (let index = 0; index < records.length; index += 200) {
      outputs.push(this.runJson([
        "base", "+record-batch-create",
        "--base-token", this.baseToken,
        "--table-id", tableName,
        "--as", "user",
        "--json", JSON.stringify({ create_records: records.slice(index, index + 200) })
      ]));
    }
    return outputs;
  }

  updateRecords(tableName, updatesByRecordId) {
    const entries = Object.entries(updatesByRecordId);
    if (!entries.length) return null;
    const outputs = [];
    for (let index = 0; index < entries.length; index += 200) {
      outputs.push(this.runJson([
        "base", "+record-batch-update",
        "--base-token", this.baseToken,
        "--table-id", tableName,
        "--as", "user",
        "--json", JSON.stringify({
          update_records: Object.fromEntries(entries.slice(index, index + 200))
        })
      ]));
    }
    return outputs;
  }

  sendMarkdown(chatId, markdown, idempotencyKey) {
    const args = [
      "im", "+messages-send",
      "--as", "bot",
      "--chat-id", chatId,
      "--markdown", markdown
    ];
    if (idempotencyKey) args.push("--idempotency-key", idempotencyKey.slice(0, 50));
    return this.runJson(args);
  }

  sendPrivateText(openId, text, idempotencyKey) {
    const args = [
      "im", "+messages-send",
      "--as", "bot",
      "--user-id", openId,
      "--text", text
    ];
    if (idempotencyKey) args.push("--idempotency-key", idempotencyKey.slice(0, 50));
    return this.runJson(args);
  }

  createTask({ summary, description = "", assignee, due, tasklistId = "", idempotencyKey = "" }) {
    const args = [
      "task", "+create",
      "--as", "bot",
      "--summary", summary,
      "--assignee", assignee,
      "--due", due
    ];
    if (description) args.push("--description", description);
    if (tasklistId) args.push("--tasklist-id", tasklistId);
    if (idempotencyKey) args.push("--idempotency-key", idempotencyKey.slice(0, 50));
    return this.runJson(args);
  }

  createCalendarEvent({ summary, start, end, attendeeIds = [], description = "" }) {
    const args = [
      "calendar", "+create",
      "--as", "bot",
      "--summary", summary,
      "--start", start,
      "--end", end
    ];
    if (attendeeIds.length) args.push("--attendee-ids", attendeeIds.join(","));
    if (description) args.push("--description", description);
    return this.runJson(args);
  }

  createDraftDocument(title, contentXml) {
    const dir = path.join(this.config.root, ".data", "doc-drafts");
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${crypto.randomUUID()}.xml`;
    const filePath = path.join(dir, fileName);
    const relativePath = path.relative(this.config.root, filePath).replaceAll("\\", "/");
    const xml = `<title>${escapeXml(title)}</title>\n${stripTitle(contentXml)}`;
    fs.writeFileSync(filePath, xml, "utf8");

    try {
      const args = ["docs", "+create", "--as", "bot", "--content", `@${relativePath}`];
      if (this.config.documents.parentToken) {
        args.push("--parent-token", this.config.documents.parentToken);
      }
      const output = this.runJson(args);
      return output.data?.document || output.data || output;
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  }

  async startEventStream(eventKey, onEvent) {
    let currentChild = null;
    let restartTimer = null;
    let restartAttempt = 0;
    let stopped = false;
    let initialSettled = false;
    let readyResolve;
    let readyReject;
    const initialReady = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    const configuredDelays = this.config.reliability?.eventRestartDelaysMs;
    const restartDelays = Array.isArray(configuredDelays) && configuredDelays.length
      ? configuredDelays
      : DEFAULT_EVENT_RESTART_DELAYS_MS;

    const scheduleRestart = (reason) => {
      if (stopped || restartTimer) return;
      const delayMs = eventRestartDelayMs(restartAttempt, restartDelays);
      restartAttempt += 1;
      console.error(`[lark] 飞书事件监听 ${eventKey} 已退出（${reason}），${delayMs}ms 后自动恢复`);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        launch(true);
      }, delayMs);
    };

    const launch = (isRestart = false) => {
      if (stopped) return;
      const invocation = larkCliInvocation(this.entry, [
        "event", "consume", eventKey,
        "--as", "bot"
      ]);
      const child = this.spawnImpl(invocation.command, invocation.args, {
        cwd: this.config.root,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      currentChild = child;
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let ready = false;
      let exitHandled = false;

      const handleExit = (code, reason = "exit") => {
        if (exitHandled) return;
        exitHandled = true;
        if (currentChild === child) currentChild = null;
        if (stopped) return;
        if (!initialSettled && !ready) {
          initialSettled = true;
          readyReject(new Error(`飞书事件监听未就绪，退出码 ${code}: ${stderrBuffer}`));
          return;
        }
        scheduleRestart(`${reason}:${code ?? "unknown"}`);
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            Promise.resolve(onEvent(JSON.parse(line))).catch((error) => {
              console.error(`[agent] 处理飞书事件 ${eventKey} 失败`, error.message);
            });
          } catch (error) {
            console.error("[agent] 无法解析飞书事件", error.message);
          }
        }
      });
      child.stderr.on("data", (chunk) => {
        stderrBuffer = `${stderrBuffer}${chunk}`.slice(-12000);
        if (!ready && stderrBuffer.includes(`[event] ready event_key=${eventKey}`)) {
          ready = true;
          restartAttempt = 0;
          if (!initialSettled) {
            initialSettled = true;
            readyResolve();
          } else if (isRestart) {
            console.log(`[lark] 飞书事件监听 ${eventKey} 已恢复`);
          }
        }
        process.stderr.write(chunk);
      });
      child.on("error", (error) => handleExit(null, error.message || "spawn-error"));
      child.on("exit", (code) => handleExit(code));
    };

    launch(false);
    await initialReady;
    return {
      get child() {
        return currentChild;
      },
      stop: () => {
        stopped = true;
        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = null;
        if (currentChild && !currentChild.killed) currentChild.stdin.end();
      }
    };
  }

  async startEventStreams(streams) {
    const handles = await Promise.all(
      streams.map(({ eventKey, onEvent }) => this.startEventStream(eventKey, onEvent))
    );
    return {
      handles,
      stop: () => handles.forEach((handle) => handle.stop())
    };
  }

  async startMessageStream(onMessage) {
    return this.startEventStream("im.message.receive_v1", onMessage);
  }
}
