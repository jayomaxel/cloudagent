import { WeeklyReviewRuntime } from "./weekly-review-runtime.js";

const rawConfig = process.env.CLOUDAGENT_REVIEW_CONFIG;
if (!rawConfig) throw new Error("CLOUDAGENT_REVIEW_CONFIG is required");

const config = JSON.parse(rawConfig);
const lark = {
  async sendPrivateText() {},
  async sendText() {},
};
const runtime = new WeeklyReviewRuntime({ config, lark });
runtime.start();

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  runtime.stop();
  setTimeout(() => process.exit(0), 10).unref();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("disconnect", stop);

