import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function loadConfig() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env"));

  const configPath = path.resolve(root, process.env.AGENT_CONFIG || "config/agent.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.root = root;
  config.provider = (process.env.AI_PROVIDER || "deepseek").toLowerCase();
  config.model = process.env.AI_MODEL || (
    config.provider === "deepseek"
      ? "deepseek-v4-flash"
      : process.env.OPENAI_MODEL || "gpt-5.6-sol"
  );
  config.aiApiKey = config.provider === "deepseek"
    ? process.env.DEEPSEEK_API_KEY || ""
    : process.env.OPENAI_API_KEY || "";
  config.aiBaseUrl = config.provider === "deepseek"
    ? process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
    : undefined;
  config.larkCliEntry = process.env.LARK_CLI_ENTRY || path.join(
    process.env.APPDATA || "",
    "npm",
    "node_modules",
    "@larksuite",
    "cli",
    "scripts",
    "run.js"
  );

  if (!config.baseToken) throw new Error("agent.config.json 缺少 baseToken");
  if (!new Set(["deepseek", "openai"]).has(config.provider)) {
    throw new Error(`不支持的 AI_PROVIDER：${config.provider}`);
  }
  if (!fs.existsSync(config.larkCliEntry)) throw new Error(`找不到飞书 CLI：${config.larkCliEntry}`);
  return config;
}
