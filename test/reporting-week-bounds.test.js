import test from "node:test";
import assert from "node:assert/strict";

import { reportingWeekBounds } from "../src/weekly-questionnaire.js";

test("Sunday submission belongs to the natural week that just ended", () => {
  const period = reportingWeekBounds("2026-08-09 18:05:52", 1);
  assert.deepEqual({ start: period.start, end: period.end }, { start: "2026-08-03", end: "2026-08-09" });
});

test("Monday submission is treated as a previous-week report", () => {
  const period = reportingWeekBounds("2026-08-10 16:34:15", 1);
  assert.deepEqual({ start: period.start, end: period.end }, { start: "2026-08-03", end: "2026-08-09" });
});

test("Tuesday submission starts the new reporting week with a one-day grace window", () => {
  const period = reportingWeekBounds("2026-08-11 09:00:00", 1);
  assert.deepEqual({ start: period.start, end: period.end }, { start: "2026-08-10", end: "2026-08-16" });
});

