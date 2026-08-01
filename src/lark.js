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

  async startMessageStream(onMessage) {
    const child = spawn(process.execPath, [
      this.entry,
      "event", "consume", "im.message.receive_v1",
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
          onMessage(JSON.parse(line));
        } catch (error) {
          console.error("[agent] 无法解析飞书事件", error.message);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk;
      if (stderrBuffer.includes("[event] ready event_key=im.message.receive_v1")) readyResolve();
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
}
