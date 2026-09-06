import path from "node:path";

export function larkCliInvocation(entry, args = []) {
  const extension = path.extname(String(entry || "")).toLowerCase();
  if ([".exe", ".cmd", ".bat"].includes(extension)) return { command: entry, args };
  return { command: process.execPath, args: [entry, ...args] };
}

