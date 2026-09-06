# Agent Reliability and Weekly Report Repair Plan

> **执行约束：** 不调整飞书权限；不向群聊发送测试或状态消息；所有线上检查均为只读。

**目标：** 修复 Agent 阻塞、审核状态机、证据分级、自动写入、周期报告和恢复机制，并核实 2026-08-03 至 2026-08-09 周报的实际生成状态。

**架构策略：** 实时消息监听保留在主进程；可能阻塞的周问卷审核和周期报告生成移入独立子进程，由可自动重启的监督器管理。规则审核先于模型审核，模型只能维持或降低可信等级，不能绕过确定性规则。自动写入采用事实 ID 和目标侧幂等校验，周期报告必须经过独立复核后才能标记为已审核。

**技术栈：** Node.js ESM、node:test、飞书 CLI/OpenAPI、OpenAI-compatible API、Zod。

---

## 任务 1：建立故障回归测试

**涉及文件：**
- Create: `test/review-gateway-v0.7.test.js`
- Create: `test/review-policy-v0.7.test.js`
- Create: `test/review-workflow-v0.7.test.js`
- Create: `test/periodic-reports-v0.7.test.js`
- Create: `test/auto-write-v0.7.test.js`
- Create: `test/review-worker-supervisor.test.js`
- Create: `test/reliability-retention.test.js`
- Modify: `test/v0.7-schema.test.js`

**验收场景：**
1. Base 列表翻页和精确字段查询不漏记录。
2. 成员自己提供的链接或附件不能单独成为 A/B 级证据。
3. 模型不能把确定性 C 级证据升级为 A 级。
4. 无有效接受事实时禁止自动写入。
5. 模型失败进入有限重试，最终进入人工队列而不是永久丢失。
6. `autoWriteVerified=false` 时不执行自动写入。
7. “暂缓/要求补充”保持待处理；“调整项目/共同贡献”可以执行且必须校验输入。
8. 周期报告只关联本周期审核队列，且独立复核失败时进入负责人审核。
9. 写入日志失败后重试不会重复创建目标记录。
10. 回滚前检测目标数据漂移，冲突时拒绝覆盖。
11. 周期审核子进程异常退出后自动拉起，主进程可独立停止。
12. 只清理超过保留期且不可恢复的批次，不删除活跃重试数据。

## 任务 2：隔离阻塞任务并恢复运行闭环

**涉及文件：**
- Create: `src/review-worker.js`
- Create: `src/review-worker-supervisor.js`
- Modify: `src/agent.js`
- Modify: `src/weekly-review-runtime.js`
- Modify: `config/studio.json`

**实施：**
1. 将周问卷审核和周期报告调度移至独立子进程。
2. 子进程退出后按退避策略重启；Agent 停止时同步关闭子进程。
3. 禁用启动时自动历史补读，历史补读保留为显式命令，防止主监听在启动阶段被长任务阻塞。
4. 为周期任务增加执行锁，避免同一任务重叠运行。

## 任务 3：修复证据规则和审核状态机

**涉及文件：**
- Modify: `src/review-policy.js`
- Modify: `src/weekly-questionnaire.js`
- Modify: `src/review-workflow.js`
- Modify: `src/review-analyzer.js`
- Modify: `src/review-schema.js`
- Modify: `src/v0.7-schema.js`

**实施：**
1. 自填链接/附件仅作为待核实材料，不计独立来源。
2. 最终证据等级取规则与模型中的更保守结果。
3. 自动通过必须至少包含一条有效接受事实。
4. 已确认的同周期、同成员、同项目证据才参与交叉验证。
5. 失败审核使用 1/5/15/60 分钟退避，达到上限后进入负责人队列。
6. 完成人工确认后同步 AI 审核记录、周问卷状态和正式记录标志。
7. 完整支持调整项目和共同贡献；暂缓与要求补充不提前结案。

## 任务 4：修复自动写入、回滚和 Base 查询

**涉及文件：**
- Modify: `src/review-base-gateway.js`
- Modify: `src/auto-write.js`
- Modify: `scripts/rollback-auto-write.js`

**实施：**
1. Base 查询支持完整翻页与服务端精确过滤。
2. 目标表写入前后均按稳定键查询，允许日志中断后的幂等恢复。
3. 共同贡献者同步写入贡献证据、社区贡献和成员成长记录。
4. 回滚先生成预览并比较当前值与写入后快照；有漂移时拒绝执行。

## 任务 5：修复周期报告双重审核

**涉及文件：**
- Modify: `src/periodic-reports.js`
- Modify: `src/review-analyzer.js`
- Modify: `src/review-schema.js`
- Modify: `src/weekly-review-runtime.js`

**实施：**
1. 周报数据源包含本周期问卷、已确认审核和本周期人工队列，不混入历史遗留项。
2. 先生成确定性报告，再润色，再由独立调用核验事实完整性和风险。
3. 模型异常、证据冲突或高风险时写入负责人审核队列，不把异常堆栈写入正式报告。
4. 报告以“类型 + 周期 + 对象”为幂等键，重复调度只更新同一条报告。

## 任务 6：迁移、验收与周报核查

**涉及文件：**
- Modify: `scripts/migrate-agent-v0.7.js`
- Modify: `package.json`
- Modify: `README.md`

**执行顺序：**
1. 运行新增定向测试，确认先失败后通过。
2. 运行完整测试套件。
3. 执行幂等迁移，补齐审核重试字段。
4. 只读查询 `Agent 周期报告`、`Agent AI审核记录`、`Agent 负责人审核队列` 和周问卷表。
5. 核对 2026-08-03 至 2026-08-09 是否到期、是否生成、审核状态和失败原因。
6. 停止旧进程，启动修复版 Agent，确认主进程心跳和审核子进程均正常。
7. 不发送群消息；验收结论只在当前 Codex 对话中汇报。

