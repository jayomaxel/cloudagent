import { loadConfig } from "./config.js";
import { LarkClient } from "./lark.js";
import { StudioAgent } from "./agent.js";

async function doctor(config, lark) {
  const auth = lark.authStatus();
  const mappings = lark.listRecords(config.tables.chatConfig, [
    "群聊ID", "群聊名称", "所属项目", "启用分析"
  ]);
  const payload = mappings.data || {};
  const records = Array.isArray(payload.records)
    ? payload.records
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.fields) && Array.isArray(payload.data)
        ? payload.data.map((row) => ({
          fields: Object.fromEntries(payload.fields.map((field, index) => [field, row[index]]))
        }))
        : [];
  const enabled = records.filter((record) => (record.fields || record)["启用分析"]);
  console.log(JSON.stringify({
    lark: auth.identities || auth,
    ai: {
      provider: config.provider,
      configured: Boolean(config.aiApiKey),
      model: config.model
    },
    enabledProjectChats: enabled.length,
    privacy: config.privacy
  }, null, 2));
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function optionValues(name) {
  return process.argv
    .flatMap((value, index) => value === name ? [process.argv[index + 1] || ""] : [])
    .flatMap((value) => value.split(",").map((item) => item.trim()).filter(Boolean));
}

async function backfill(config, lark) {
  const start = optionValue("--start");
  const end = optionValue("--end") || new Date().toISOString();
  if (!start) throw new Error("历史补读需要指定 --start，例如 2026-08-01T00:00:00+08:00");
  const agent = new StudioAgent(config, lark);
  const result = await agent.backfill({
    start,
    end,
    chatIds: optionValues("--chat-id")
  });
  console.log(JSON.stringify(result, null, 2));
}

async function syncIdentities(config, lark) {
  const agent = new StudioAgent(config, lark);
  const result = await agent.syncEvidenceIdentities();
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const config = loadConfig();
  const lark = new LarkClient(config);
  const command = process.argv[2] || "listen";

  if (command === "doctor") {
    await doctor(config, lark);
    return;
  }
  if (command === "backfill") {
    await backfill(config, lark);
    return;
  }
  if (command === "sync-identities") {
    await syncIdentities(config, lark);
    return;
  }
  if (command !== "listen") throw new Error(`未知命令：${command}`);

  const agent = new StudioAgent(config, lark);
  await agent.start();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("[agent] 正在安全停止...");
    await agent.stop();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(`[agent] ${error.stack || error.message}`);
  process.exitCode = 1;
});
