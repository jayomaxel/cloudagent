# Weekly Questionnaire AI Review and Periodic Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `成员周成长记录` into CloudAgent's evidence pipeline, run deterministic checks plus two independent AI stages, auto-write only low-risk verified outcomes, route exceptions privately to 焦雪晴, and generate governed weekly/monthly reports.

**Architecture:** Keep the existing Agent orchestration intact and add focused modules for questionnaire normalization, review policy, AI extraction/review, workflow persistence, and periodic reports. The existing Base remains the source of truth; every result receives a stable ID, evidence links, an audit record, and a reversible write ledger. Existing questionnaire rows are marked `历史待处理` during migration so rollout does not create an alert storm.

**Tech Stack:** Node.js ES modules, `node:test`, Zod, OpenAI-compatible DeepSeek API, `lark-cli`, Feishu Base, existing CloudAgent supervisor and retry infrastructure.

## Global Constraints

- Do not send review reminders or disputes to group chats.
- High-risk items may only be sent privately to `ou_10aa90c9cba9aaa057c8a36fd5c9e547`.
- Do not infer personality, morality, psychology, or ability.
- Message count and speaking frequency must not be treated as contribution.
- Self-report without independent evidence remains `成员自述` and cannot become a confirmed contribution.
- Only evidence grade A or B, low-risk, conflict-free facts may auto-write.
- Every write must have an idempotency key, before/after snapshot, target record ID, and rollback status.
- Existing Base fields and records are never deleted or renamed.
- Existing questionnaire records are not auto-processed at rollout.
- Low-value normalization uses deterministic rules; the normal model performs extraction/review; high-risk results are escalated to human review.

---

### Task 1: Pure review policy and questionnaire normalization

**Files:**
- Create: `src/review-policy.js`
- Create: `src/weekly-questionnaire.js`
- Test: `test/review-policy.test.js`
- Test: `test/weekly-questionnaire.test.js`

**Interfaces:**
- Produces: `normalizeWeeklySubmission(record, memberDirectory, projectCatalog)`.
- Produces: `runDeterministicChecks(candidate, existingFacts)`.
- Produces: `decideReviewOutcome({ extraction, verification, checks })`.
- Produces: `buildReviewId(recordId, weekKey)` and `buildWriteOperationId(reviewId, target)`.

- [ ] **Step 1: Write policy tests** covering A/B/C/D evidence grades, sensitive keywords, high-risk operations, identity/project conflicts, duplicate facts, and the rule that confidence alone never permits auto-write.
- [ ] **Step 2: Run `node --test test/review-policy.test.js` and confirm it fails because the module does not exist.**
- [ ] **Step 3: Implement deterministic normalization and decision rules.** Use stable SHA-256 IDs, normalize member/project names, extract HTTP links, preserve raw text, and return one of `自动通过`, `待补充`, `人工审核`, or `驳回重复`.
- [ ] **Step 4: Write questionnaire tests** for the existing fields `姓名`, `周次`, `本周具体工作&解决了什么问题`, `本周可展示成果`, `AI协作过程`, `遇到的困难与需要的支持`, `主动同步或协作了什么`, `本周最满意&最不满意的一点`, and `当前项目或学习主题`.
- [ ] **Step 5: Run both focused tests and confirm they pass.**

### Task 2: Independent AI extraction and verification

**Files:**
- Create: `src/review-analyzer.js`
- Create: `src/review-schema.js`
- Test: `test/review-analyzer.test.js`
- Modify: `src/config.js`

**Interfaces:**
- Consumes: normalized candidate from Task 1.
- Produces: `ReviewAnalyzer.extractWeeklyCandidate(input)`.
- Produces: `ReviewAnalyzer.verifyWeeklyCandidate(input)`.
- Produces: Zod-validated extraction and verification objects.

- [ ] **Step 1: Write tests** proving prompts contain only redacted questionnaire/evidence content, extraction and verification use separate system prompts, malformed JSON is rejected, and telemetry records purpose/model/token usage.
- [ ] **Step 2: Run `node --test test/review-analyzer.test.js` and confirm it fails.**
- [ ] **Step 3: Implement the analyzer** with OpenAI-compatible DeepSeek calls, `maxRetries: 0`, configured timeout, JSON response format, and the existing telemetry callback contract.
- [ ] **Step 4: Add environment routing** for `AI_REVIEW_MODEL` and `AI_HIGH_RISK_MODEL`, both defaulting to the configured normal Agent model when not set.
- [ ] **Step 5: Run the focused tests and confirm they pass.**

### Task 3: Additive Base schema and migration

**Files:**
- Create: `src/v0.7-schema.js`
- Create: `scripts/migrate-agent-v0.7.js`
- Test: `test/v0.7-schema.test.js`
- Modify: `config/agent.config.json`
- Modify: `package.json`

**Interfaces:**
- Produces: additive table/field definitions and an idempotent migration planner.
- Produces tables: `Agent AI审核记录`, `Agent 负责人审核队列`, `Agent 自动写入日志`, `Agent 周期报告`.
- Adds fields to `成员周成长记录`: `成员`, `周期开始`, `周期结束`, `所属项目`, `事实ID`, `证据等级`, `风险等级`, `AI审核状态`, `AI审核说明`, `AI审核时间`, `进入正式记录`.

- [ ] **Step 1: Write migration tests** for exact table names, exact field names/options, no destructive operations, and idempotent planning.
- [ ] **Step 2: Run `node --test test/v0.7-schema.test.js` and confirm it fails.**
- [ ] **Step 3: Implement schema definitions** with only stored fields; no formula/lookup fields are written by the Agent.
- [ ] **Step 4: Implement migration dry-run and `--apply` modes.** During apply, mark pre-existing blank questionnaire rows as `历史待处理`; do not process or notify them.
- [ ] **Step 5: Add table names, schedules, owner ID, and feature flags to config.** Set version to `0.7.0`, `processExisting=false`, `groupNotifications=false`, and add package scripts for migration, backfill, and rollback.
- [ ] **Step 6: Run the focused test and migration dry-run.**

### Task 4: Review workflow persistence and private exception queue

**Files:**
- Create: `src/review-workflow.js`
- Test: `test/review-workflow.test.js`

**Interfaces:**
- Consumes: Lark client, ReviewAnalyzer, policy functions, member/project suppliers, and Agent telemetry.
- Produces: `processPendingWeeklySubmissions({ includeHistory })`.
- Produces: `processHumanReviewDecisions()`.
- Produces: `sendDueReviewDigest()`.

- [ ] **Step 1: Write tests** for blank/new rows, `历史待处理` exclusion, idempotent review IDs, deterministic rejection before model calls, two-stage model calls, Base write ordering, and private-only reminders.
- [ ] **Step 2: Run `node --test test/review-workflow.test.js` and confirm it fails.**
- [ ] **Step 3: Implement questionnaire loading and member/project/evidence matching.** Use exact member names/open IDs, confirmed project aliases, existing Agent facts, contribution evidence, and project data.
- [ ] **Step 4: Persist first-stage and second-stage output** in `Agent AI审核记录`, then update only the review metadata fields on the source questionnaire row.
- [ ] **Step 5: Create queue records only for `待补充` and `人工审核`.** High risk uses immediate private owner notification; ordinary unresolved items are combined into one daily private digest; unchanged items are never re-notified.
- [ ] **Step 6: Implement decision polling** for `确认`, `修改后确认`, `要求补充`, `暂缓`, `驳回`, `标记共同贡献`, and `调整项目`.
- [ ] **Step 7: Run the focused tests and confirm they pass.**

### Task 5: Reversible auto-write

**Files:**
- Create: `src/auto-write.js`
- Create: `scripts/rollback-auto-write.js`
- Test: `test/auto-write.test.js`

**Interfaces:**
- Produces: `applyVerifiedReview(review)`.
- Produces: `rollbackWrite(operationId)`.
- Writes only `Agent 贡献证据`, `社区贡献`, and append-only verified summaries in `成员档案.成长记录` when policy permits.

- [ ] **Step 1: Write tests** proving C/D evidence, medium/high risk, conflicts, or human-review flags never write; repeated operation IDs are idempotent; existing member growth text is preserved; rollback restores the exact before snapshot.
- [ ] **Step 2: Run `node --test test/auto-write.test.js` and confirm it fails.**
- [ ] **Step 3: Implement write planning** before mutations, including target table, target record, before snapshot, after snapshot, and operation ID.
- [ ] **Step 4: Persist the pending write ledger first, perform the Base update/create, then mark the ledger successful.** On failure, retain a retryable ledger without claiming success.
- [ ] **Step 5: Implement rollback CLI** requiring an exact operation ID and refusing already rolled-back or incomplete operations.
- [ ] **Step 6: Run the focused tests and confirm they pass.**

### Task 6: Weekly and monthly report generation

**Files:**
- Create: `src/periodic-reports.js`
- Test: `test/periodic-reports.test.js`

**Interfaces:**
- Produces: `periodKey(type, now, timezone)`.
- Produces: `buildMemberWeeklyReport`, `buildProjectWeeklyReport`, `buildStudioWeeklyReport`, `buildMemberMonthlyReport`, `buildProjectMonthlyReport`, and `buildStudioMonthlyReport`.
- Produces: `generateDueReports(now)` with idempotent report IDs.

- [ ] **Step 1: Write tests** for Asia/Shanghai natural weeks/months, all six report types, empty-period skipping, questionnaire/evidence distinction, conflict sections, no activity-count scoring, and stable report IDs.
- [ ] **Step 2: Run `node --test test/periodic-reports.test.js` and confirm it fails.**
- [ ] **Step 3: Implement deterministic aggregation** from approved questionnaires, verified facts, project records, queue state, and work-style observations.
- [ ] **Step 4: Use AI only to improve readable prose after the deterministic report structure is complete.** Preserve evidence links and explicit labels `已核验事实`, `成员自述`, `AI推断`, and `待负责人确认`.
- [ ] **Step 5: Persist reports in `Agent 周期报告`.** Low-risk reports become `AI已审核`; reports containing sensitive member evaluation, unresolved conflicts, or high risk become `待负责人审核`.
- [ ] **Step 6: Run the focused tests and confirm they pass.**

### Task 7: Agent runtime integration

**Files:**
- Modify: `src/agent.js`
- Test: `test/weekly-review-integration.test.js`

**Interfaces:**
- Instantiates `WeeklyReviewWorkflow`, `AutoWriteService`, and `PeriodicReportService` after runtime mappings are available.
- Adds bounded timers for pending questionnaires, human decisions, daily digest, and due reports.

- [ ] **Step 1: Write integration tests** proving realtime event consumers start before review initialization, review failures do not stop message listeners, timers are cleared on shutdown, and group message methods are never called.
- [ ] **Step 2: Run `node --test test/weekly-review-integration.test.js` and confirm it fails.**
- [ ] **Step 3: Add services and timers** using existing lifecycle cleanup and health event conventions. Startup review processing is optional and must not block the four realtime consumers.
- [ ] **Step 4: Add health counters** for pending reviews, high-risk queue items, last weekly report, last monthly report, and failed review batches without changing existing alert privacy rules.
- [ ] **Step 5: Run the focused integration test and confirm it passes.**

### Task 8: Controlled backfill and rollout

**Files:**
- Create: `scripts/backfill-weekly-reviews.js`
- Create: `CloudAgent-v0.7.0-问卷审核与周期报告实施说明.md`

**Interfaces:**
- Backfill accepts `--from`, `--to`, `--member`, `--limit`, `--dry-run`, and `--apply`.
- Dry-run never calls models, writes Base, or sends messages.
- Apply processes selected `历史待处理` records without private notifications unless `--notify` is explicitly supplied.

- [ ] **Step 1: Implement dry-run selection and output** with record IDs, member names, week, project candidate, and estimated model-call count.
- [ ] **Step 2: Implement apply mode** through the same workflow used by the running Agent.
- [ ] **Step 3: Document model routing, Base tables, review decisions, rollback command, schedules, privacy rules, and operator checklist.**
- [ ] **Step 4: Run the complete suite with `npm.cmd test`.** Expected: all tests pass.
- [ ] **Step 5: Run migration dry-run, inspect the additive plan, then run migration apply.**
- [ ] **Step 6: Restart one supervised Agent instance and verify four event consumers, version `0.7.0`, fresh heartbeat, and no group messages.**
- [ ] **Step 7: Run backfill dry-run only.** Report the selected history scope and estimated cost before any historical AI calls.

