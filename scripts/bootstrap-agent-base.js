import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BASE_TOKEN = "WGq3bSaOga59t5sXtRBch647nBh";
const CLI = process.env.LARK_CLI_ENTRY || path.join(
  process.env.APPDATA || "",
  "npm",
  "node_modules",
  "@larksuite",
  "cli",
  "scripts",
  "run.js"
);

function call(args) {
  const result = spawnSync(process.execPath, [CLI, ...args, "--format", "json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim());
  const start = result.stdout.indexOf("{");
  const output = JSON.parse(result.stdout.slice(start));
  if (output.ok === false) throw new Error(JSON.stringify(output.error || output));
  return output;
}

const tableDefinitions = [
  {
    name: "Agent 群聊配置",
    fields: [
      { name: "配置名称", type: "text" },
      { name: "群聊ID", type: "text" },
      { name: "群聊名称", type: "text" },
      { name: "所属项目", type: "text" },
      { name: "启用分析", type: "checkbox" },
      { name: "允许文档草稿", type: "checkbox" },
      { name: "负责人", type: "user", multiple: false },
      { name: "数据保留天数", type: "number" },
      { name: "最近同步", type: "datetime" },
      { name: "说明", type: "text" }
    ]
  },
  {
    name: "Agent 贡献证据",
    fields: [
      { name: "证据标题", type: "text" },
      { name: "消息ID", type: "text" },
      { name: "群聊ID", type: "text" },
      { name: "消息时间", type: "datetime" },
      { name: "贡献成员", type: "user", multiple: false },
      { name: "所属项目", type: "text" },
      { name: "贡献类型", type: "select", multiple: false, options: [
        { name: "技术实现" }, { name: "项目推进" }, { name: "产品需求" },
        { name: "协作支持" }, { name: "知识沉淀" }, { name: "风险担当" }, { name: "组织贡献" }
      ] },
      { name: "证据摘要", type: "text" },
      { name: "置信度", type: "number" },
      { name: "审核状态", type: "select", multiple: false, options: [
        { name: "待确认" }, { name: "已确认" }, { name: "已修正" }, { name: "已忽略" }
      ] },
      { name: "需要人工复核", type: "checkbox" },
      { name: "身份状态", type: "select", multiple: false, options: [
        { name: "已匹配项目成员" }, { name: "工作室成员·非项目成员" }, { name: "身份待确认" },
        { name: "暂休成员" }, { name: "已退出成员" }, { name: "指导教师" },
        { name: "外部协作者" }, { name: "临时参与者" }
      ] },
      { name: "身份判定说明", type: "text" },
      { name: "成员档案记录ID", type: "text" },
      { name: "项目成员关系记录ID", type: "text" },
      { name: "允许进入成员总结", type: "checkbox" },
      { name: "Agent版本", type: "text" }
    ]
  },
  {
    name: "Agent 行动项",
    fields: [
      { name: "行动项", type: "text" },
      { name: "所属项目", type: "text" },
      { name: "群聊ID", type: "text" },
      { name: "来源消息ID", type: "text" },
      { name: "负责人", type: "user", multiple: false },
      { name: "截止时间", type: "datetime" },
      { name: "状态", type: "select", multiple: false, options: [
        { name: "待确认" }, { name: "已确认" }, { name: "进行中" }, { name: "已完成" }, { name: "已取消" }
      ] },
      { name: "置信度", type: "number" },
      { name: "生成时间", type: "datetime" },
      { name: "Agent版本", type: "text" }
    ]
  },
  {
    name: "Agent 决策记录",
    fields: [
      { name: "决策标题", type: "text" },
      { name: "所属项目", type: "text" },
      { name: "群聊ID", type: "text" },
      { name: "来源消息ID", type: "text" },
      { name: "决策内容", type: "text" },
      { name: "决策原因", type: "text" },
      { name: "参与成员ID", type: "text" },
      { name: "置信度", type: "number" },
      { name: "审核状态", type: "select", multiple: false, options: [
        { name: "待确认" }, { name: "已确认" }, { name: "已修正" }, { name: "已废止" }
      ] },
      { name: "生成时间", type: "datetime" },
      { name: "Agent版本", type: "text" }
    ]
  },
  {
    name: "Agent 文档审核",
    fields: [
      { name: "草稿标题", type: "text" },
      { name: "文档类型", type: "select", multiple: false, options: [
        { name: "项目周报" }, { name: "决策记录" }, { name: "技术知识" },
        { name: "项目复盘" }, { name: "SOP修订建议" }, { name: "成员成长观察" }
      ] },
      { name: "所属项目", type: "text" },
      { name: "草稿内容", type: "text" },
      { name: "来源消息ID", type: "text" },
      { name: "风险级别", type: "select", multiple: false, options: [
        { name: "低" }, { name: "中" }, { name: "高" }
      ] },
      { name: "审核状态", type: "select", multiple: false, options: [
        { name: "待审核" }, { name: "修改中" }, { name: "已通过" }, { name: "已发布" }, { name: "已退回" }
      ] },
      { name: "审核人", type: "user", multiple: false },
      { name: "修订意见", type: "text" },
      { name: "草稿文档", type: "text", style: { type: "url" } },
      { name: "生成时间", type: "datetime" },
      { name: "Agent版本", type: "text" }
    ]
  },
  {
    name: "项目成员关系",
    fields: [
      { name: "关系名称", type: "text" },
      { name: "所属项目", type: "text" },
      { name: "成员", type: "user", multiple: false },
      { name: "项目角色", type: "select", multiple: false, options: [
        { name: "负责人" }, { name: "开发" }, { name: "产品" }, { name: "设计" },
        { name: "测试" }, { name: "运营" }, { name: "指导者" }, { name: "其他" }
      ] },
      { name: "成员类型", type: "select", multiple: false, options: [
        { name: "工作室成员" }, { name: "指导教师" }, { name: "外部协作者" }, { name: "临时参与者" }
      ] },
      { name: "关系状态", type: "select", multiple: false, default_value: ["待确认"], options: [
        { name: "待确认" }, { name: "活跃" }, { name: "暂停" }, { name: "已退出" }
      ] },
      { name: "加入日期", type: "datetime", style: { format: "yyyy-MM-dd" } },
      { name: "退出日期", type: "datetime", style: { format: "yyyy-MM-dd" } },
      { name: "说明", type: "text" },
      { name: "更新时间", type: "updated_at", style: { format: "yyyy-MM-dd HH:mm" } }
    ]
  }
];

const existing = call(["base", "+table-list", "--base-token", BASE_TOKEN, "--as", "user"])
  .data.tables;
const result = { baseToken: BASE_TOKEN, createdAt: new Date().toISOString(), tables: [] };

for (const definition of tableDefinitions) {
  const found = existing.find((table) => table.name === definition.name);
  if (found) {
    result.tables.push({ name: definition.name, id: found.id, status: "already_exists" });
    continue;
  }
  const output = call([
    "base", "+table-create",
    "--base-token", BASE_TOKEN,
    "--as", "user",
    "--name", definition.name,
    "--fields", JSON.stringify(definition.fields)
  ]);
  const data = output.data || {};
  result.tables.push({
    name: definition.name,
    id: data.table?.id || data.table_id || data.id,
    status: "created"
  });
}

fs.writeFileSync(
  path.join(process.cwd(), "agent-base-result.json"),
  JSON.stringify(result, null, 2) + "\n",
  "utf8"
);
process.stdout.write(JSON.stringify(result, null, 2));
