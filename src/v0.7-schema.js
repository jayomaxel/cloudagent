export const V07_TABLES = {
  aiReviews: "Agent AI审核记录",
  reviewQueue: "Agent 负责人审核队列",
  autoWriteLog: "Agent 自动写入日志",
  periodicReports: "Agent 周期报告"
};

const select = (name, options, defaultValue) => ({ name, type: "select", options, ...(defaultValue ? { defaultValue } : {}) });
const text = (name) => ({ name, type: "text" });
const date = (name) => ({ name, type: "datetime" });
const user = (name, multiple = false) => ({ name, type: "user", multiple });
const checkbox = (name) => ({ name, type: "checkbox" });
const number = (name) => ({ name, type: "number" });

export const V07_SCHEMA = {
  [V07_TABLES.aiReviews]: [
    text("审核ID"), text("来源记录ID"), select("来源类型", ["成员周问卷", "周期报告"]), text("周期"), user("成员"), text("成员名称"),
    text("所属项目"), text("事实ID"), text("候选内容"), text("第一层提取"), text("第二层审核"), select("证据等级", ["A", "B", "C", "D"]),
    select("风险等级", ["低", "中", "高"]), select("审核状态", ["自动通过", "待补充", "人工审核", "驳回重复", "处理失败"]),
    checkbox("需要人工审核"), checkbox("允许正式写入"), text("审核说明"), text("证据链接"), text("审核模型"), number("Token用量"),
    date("创建时间"), date("完成时间"), number("重试次数"), date("下次重试时间"), text("Agent版本")
  ],
  [V07_TABLES.reviewQueue]: [
    text("事项ID"), text("审核ID"), select("事项类型", ["负责人审核", "待成员补充", "周期报告审核"]), user("成员"), text("成员名称"),
    text("所属项目"), select("风险等级", ["低", "中", "高"]), text("事实摘要"), text("待确认问题"), text("证据链接"), text("AI建议"),
    user("审核负责人"), select("审核状态", ["待审核", "确认", "修改后确认", "要求补充", "暂缓", "驳回", "标记共同贡献", "调整项目"], "待审核"),
    text("人工修订"), text("调整后项目"), user("共同贡献者", true), date("最后提醒时间"), number("提醒次数"), checkbox("已执行"), date("执行时间"),
    date("创建时间"), text("Agent版本")
  ],
  [V07_TABLES.autoWriteLog]: [
    text("操作ID"), text("审核ID"), text("目标表"), text("目标记录ID"), select("操作类型", ["新建", "更新", "删除"]),
    text("写入前快照"), text("写入后快照"), select("执行状态", ["待执行", "成功", "失败", "已回滚"]), text("错误信息"),
    date("创建时间"), date("完成时间"), date("回滚时间"), text("Agent版本")
  ],
  [V07_TABLES.periodicReports]: [
    text("报告ID"), select("报告类型", ["成员周报", "项目周报", "工作室周报", "成员月报", "项目月报", "工作室月报"]),
    date("周期开始"), date("周期结束"), user("成员"), text("成员名称"), text("所属项目"),
    select("报告状态", ["AI已审核", "待负责人审核", "已确认", "已发布", "已退回"]), text("报告内容"), text("来源记录ID"),
    text("证据链接"), select("风险等级", ["低", "中", "高"]), text("AI审核说明"), user("审核负责人"), date("生成时间"), text("Agent版本")
  ]
};

export const WEEKLY_FIELD_ADDITIONS = [
  user("成员"), date("周期开始"), date("周期结束"), text("所属项目"), text("事实ID"), select("证据等级", ["A", "B", "C", "D"]),
  select("风险等级", ["低", "中", "高"]), select("AI审核状态", ["自动通过", "待补充", "人工审核", "驳回重复", "历史待处理", "处理失败"]),
  text("AI审核说明"), date("AI审核时间"), checkbox("进入正式记录")
];

export function computeV07Migration(existingTables = {}) {
  const createTables = [];
  const addFields = [];
  for (const [tableName, fields] of Object.entries(V07_SCHEMA)) {
    if (!existingTables[tableName]) createTables.push({ tableName, fields });
    else {
      const existingFields = new Set(existingTables[tableName]);
      for (const field of fields) if (!existingFields.has(field.name)) addFields.push({ tableName, field });
    }
  }
  const weeklyFields = new Set(existingTables["成员周成长记录"] || []);
  for (const field of WEEKLY_FIELD_ADDITIONS) if (!weeklyFields.has(field.name)) addFields.push({ tableName: "成员周成长记录", field });
  return { createTables, addFields, destructiveChanges: [] };
}
