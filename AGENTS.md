# 项目导航

WeChat × Pi Agent：通过微信 iLink 使用的 Node.js / TypeScript 个人助手。

## 从这里开始

- [使用与当前能力](README.md)
- [文档地图与维护规则](docs/README.md)
- [业务需求](docs/specs/README.md)：目标、范围与验收条件。
- [变更与计划](docs/changelog/README.md)：下一步、进度与交付证据。
- [系统架构](docs/architecture/README.md)：当前连接关系与设计提案。
- [操作与排障](docs/runbook/README.md)
- [外部源码依据](docs/vendor/README.md)
- [中文知识库](docs/wiki/README.md)

## 代码入口

- `src/bootstrap/container.ts`：依赖组装、后台循环与启停。
- `src/application/use-cases/`：消息、Turn、投递与会话生命周期。
- `src/adapters/outbound/pi/`：Agent、模型认证、工具与上下文。
- `src/adapters/outbound/sqlite/`：持久化；`test/`：验证。

## 工作约定

- 从原始问题出发；目标不清楚先讨论。查真实代码与证据，区分提案、已实现和已验证。
- 开发前读对应需求、设计与计划。行为变更同步受影响的文档，进度和验证证据统一记入 changelog。
- 本文件只保留稳定导航与必要约束；需求详情、任务进度、长方案和排障结论写入 docs。
- 除非用户明确要求，禁止运行 `go build`、`go test`、`go vet`。
- TypeScript 验证按改动选择 `npm run lint`、`npm run typecheck` 和相关测试；完整检查见 `package.json` 的 `check`。纯文档变更检查链接和 diff。
- 不提交凭证、运行数据或私有对话；未关联当前任务的工作区改动保持原样。

## 自动维护

- 开始变更先查 [规格状态地图](docs/specs/MAP.md)，分清现行能力与待生效变更；历史材料不作为当前契约。
- 手动写规格用 `$project-spec`；内容进入 docs/specs，不另写重复 design。
- 实际开发/排障收尾执行 `$project-learning-sync`，按证据自动更新 Runbook/Wiki；无经验可沉淀则不写。用户要求只读时仍保持只读。
- 提交前先执行 `$project-spec-review` 核对条款与代码，再执行 `$project-change-sync`；Git Hook 按此顺序自动兜底。不得修改要求掩盖实现偏差。
- 沉淀完成按 Skill 确认 learning-ack；正常先沉淀再提交，Stop 只补漏。不得用 Hook 自动扩大提交/推送权限。
- [安装与故障处理](docs/runbook/project-workflow.md)；四个 Skill 在 .agents/skills，供本项目开发使用。
