import { loadConfig } from "../src/config.js";
import { AutoWriteService } from "../src/auto-write.js";
import { ReviewBaseGateway } from "../src/review-base-gateway.js";

const index = process.argv.indexOf("--operation-id");
const operationId = index >= 0 ? process.argv[index + 1] : "";
if (!operationId) throw new Error("必须提供 --operation-id <精确操作ID>");
if (!process.argv.includes("--apply")) {
  const config = loadConfig();
  const service = new AutoWriteService({ gateway: new ReviewBaseGateway(config), config });
  console.log(JSON.stringify({ mode: "dry-run", ...service.previewRollback(operationId), message: "确认预览后添加 --apply 执行回滚" }, null, 2));
} else {
  const config = loadConfig();
  const service = new AutoWriteService({ gateway: new ReviewBaseGateway(config), config });
  console.log(JSON.stringify(service.rollbackWrite(operationId), null, 2));
}
