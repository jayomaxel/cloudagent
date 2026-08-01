import fs from "node:fs";
import { spawnSync } from "node:child_process";

const cli = "C:\\Users\\jayomaxel\\AppData\\Roaming\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js";
const questions = fs.readFileSync("member-registration-questions.json", "utf8").trim();
const result = spawnSync(process.execPath, [
  cli,
  "base",
  "+form-questions-update",
  "--base-token",
  "WGq3bSaOga59t5sXtRBch647nBh",
  "--table-id",
  "tblxmtpseZxi9LET",
  "--form-id",
  "vewYarXU02",
  "--questions",
  questions,
  "--as",
  "user",
  "--format",
  "json",
], { encoding: "utf8" });

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
