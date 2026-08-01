# CloudAgent

CloudAgent is a Feishu-first studio operations agent for AI teams. It listens to approved group chats, extracts contribution evidence, pending action items, decisions, and draft documentation, then writes those structured outputs back into a Feishu operations workspace for human review.

CloudAgent 面向 AI 工作室和项目团队，核心目标不是“替人做管理”，而是先把分散在群聊里的推进信息、协作证据和知识草稿整理出来，再交给负责人校正和沉淀。

## What It Does

- Listens only to approved Feishu groups
- Batches chat messages into analysis windows
- Extracts structured operational signals instead of raw chat dumps
- Writes results into Feishu Base tables for review
- Supports DeepSeek and OpenAI-compatible model providers
- Keeps humans in the loop for final confirmation

## 它解决什么问题

- 项目推进信息容易埋在群聊里，负责人回看成本很高
- 团队贡献、行动项和决策记录缺乏统一沉淀
- 工作室知识库往往只在“知道的人脑子里”，很难传承
- AI 协作过程没有被结构化，后续复盘和培养接班人都很难

## Core Outputs

CloudAgent currently writes to the following Feishu-side operational surfaces:

- `Agent 群聊配置`
- `Agent 贡献证据`
- `Agent 行动项`
- `Agent 决策记录`
- `Agent 文档审核`

These outputs are intentionally review-first. The system is designed to prepare evidence and drafts, not to silently publish final organizational conclusions.

## 核心原则

- 只分析授权群聊，不碰未授权空间
- 默认不长期存原始聊天正文
- 不按发言数量粗暴衡量贡献
- 不做人品、心理和隐性排名判断
- 正式 SOP、规则和结论默认都要人工确认
- 机器人负责起草，人类负责定稿

## Architecture

At a high level, the workflow is:

1. Feishu group messages are received through the event stream.
2. Approved groups are filtered through the group configuration table.
3. Messages are batched into a time window.
4. The analyzer sends structured prompts to the configured model provider.
5. Results are written back to Feishu operational tables.
6. A human reviewer confirms, revises, or rejects the generated records.

## 典型使用流程

1. 成员在项目群、开发组或专题群同步进展
2. CloudAgent 按批次整理贡献证据、待确认行动项和决策线索
3. 负责人在飞书运营中台核对归属、修正文案、处理争议
4. 审核通过的内容沉淀到正式项目记录、周报、月报或知识库

## Repository Structure

- `src/`: runtime, analyzers, Feishu integration, schemas
- `scripts/`: bootstrap and workspace setup scripts
- `config/`: runtime configuration
- `README.md`: public-facing project overview
- `PROJECT_OVERVIEW_V1.md`: first-version product/project brief
- `RELEASE_NOTES_v0.1.0.md`: release draft for the initial version
- `云门工作室管理Agent-详细设计.md`: current detailed design document

## Quick Start

1. Install dependencies with `npm install`.
2. Prepare environment variables from `.env.example`.
3. Bootstrap the Feishu workspace structures when needed.
4. Run the doctor command to verify auth and configuration.
5. Start the listener.

```powershell
npm run bootstrap
npm run doctor
npm run agent
```

## Environment

This repository expects a local `.env` file for secrets and provider configuration. The tracked `.env.example` file is safe to publish and can be used as the template.

Typical setup includes:

- model provider selection
- model API credentials
- Feishu app credentials
- runtime behavior flags

## Status

Current repo version: `0.1.0`

Current repo focus:

- Feishu-based studio operations
- contribution and decision capture
- weekly/monthly project reporting foundations
- human-reviewed knowledge drafting

## Roadmap

- richer project routing across shared groups such as a general development group
- weekly and monthly reporting pipelines
- member correction workflows for contribution attribution
- stronger operational dashboards
- safer evidence confidence handling

## Project Docs

- Product brief: [PROJECT_OVERVIEW_V1.md](./PROJECT_OVERVIEW_V1.md)
- Release draft: [RELEASE_NOTES_v0.1.0.md](./RELEASE_NOTES_v0.1.0.md)
- Detailed design: [云门工作室管理Agent-详细设计.md](./云门工作室管理Agent-详细设计.md)

## License

This project is released under the MIT License. See [LICENSE](./LICENSE).
