import { loadConfig } from "../src/config.js";
import { createStandaloneReviewServices } from "../src/weekly-review-runtime.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const apply = process.argv.includes("--apply");
const notify = process.argv.includes("--notify");
const config = loadConfig();
const { workflow } = createStandaloneReviewServices(config);
const options = {
  includeHistory: true,
  member: arg("--member"),
  from: arg("--from"),
  to: arg("--to"),
  limit: Number(arg("--limit", "20")) || 20,
  notify
};

if (!apply) {
  const preview = workflow.previewPending(options);
  console.log(JSON.stringify({ mode: "dry-run", selected: preview.length, estimatedModelCalls: preview.reduce((sum, item) => sum + item.estimatedModelCalls, 0), records: preview }, null, 2));
} else {
  const results = await workflow.processPendingWeeklySubmissions(options);
  console.log(JSON.stringify({ mode: "apply", processed: results.length, results: results.map((item) => ({ recordId: item.candidate?.recordId, status: item.status, error: item.error?.message || "" })) }, null, 2));
}

