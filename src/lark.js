import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";

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

export class LarkClient {
  constructor(config) {
    this.config = config;
    this.entry = config.larkCliEntry;
    this.baseToken = config.baseToken;
  }

  runJson(args) {
    const finalArgs = args.includes("--format") || args.includes("--json")
      ? args
      : [...args, "--format", "json"];
    const result = spawnSync(process.execPath, [this.entry, ...finalArgs], {
      cwd: this.config.root,
      encoding: "utf8",
      windowsHide: true
    });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim());
    const output = parseJsonOutput(result.stdout);
    if (output.ok === false) throw new Error(JSON.stringify(output.error || output));
    return output;
  }

  authStatus() {
    return this.runJson(["auth", "status"]);
  }

  listRecords(tableName, fields = []) {
    const args = [
      "base", "+record-list",
      "--base-token", this.baseToken,
      "--table-id", tableName,
      "--limit", "200",
      "--as", "user"
    ];
    for (const field of fields) args.push("--field-id", field);
    return this.runJson(args);
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
    const child = spawn(process.execPath, [
      this.entry,
      "event", "consume", eventKey,
      "--as", "bot"
    ], {
      cwd: this.config.root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

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
      stderrBuffer += chunk;
      if (stderrBuffer.includes(`[event] ready event_key=${eventKey}`)) readyResolve();
      process.stderr.write(chunk);
    });
    child.on("exit", (code) => {
      if (!stderrBuffer.includes("[event] ready")) {
        readyReject(new Error(`飞书事件监听未就绪，退出码 ${code}: ${stderrBuffer}`));
      }
    });

    await ready;
    return {
      child,
      stop: () => {
        if (!child.killed) child.stdin.end();
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
