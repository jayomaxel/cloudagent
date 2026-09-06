import { loadConfig } from "../src/config.js";
import { ReviewBaseGateway } from "../src/review-base-gateway.js";

const config = loadConfig();
const gateway = new ReviewBaseGateway(config);
const specs = {
  weeklyGrowth: ["姓名", "周次", "提交时间", "当前项目或学习主题", "周期开始", "周期结束", "AI审核状态", "AI审核说明", "进入正式记录", "事实ID", "所属项目"],
  aiReviews: ["审核ID", "来源类型", "周期", "成员名称", "所属项目", "审核状态", "审核说明", "重试次数", "下次重试时间", "来源记录ID"],
  reviewQueue: ["事项ID", "审核ID", "事项类型", "成员名称", "所属项目", "审核状态", "已执行", "待确认问题"],
  periodicReports: ["报告ID", "报告类型", "周期开始", "周期结束", "成员名称", "所属项目", "报告状态", "风险等级", "AI审核说明", "来源记录ID", "生成时间"],
};

const output = {};
for (const [key, fields] of Object.entries(specs)) {
  output[key] = gateway.listRecords(config.tables[key], fields).map((row) => ({
    record_id: row.record_id,
    fields: row.fields,
  }));
}

console.log(JSON.stringify(output, null, 2));
