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

async function main() {
  const config = loadConfig();
  const lark = new LarkClient(config);
  const command = process.argv[2] || "listen";

  if (command === "doctor") {
    await doctor(config, lark);
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
