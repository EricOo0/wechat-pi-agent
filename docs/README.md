# 文档地图

根目录 [AGENTS.md](../AGENTS.md) 是快速入口。本目录保存需求、结构和可复用维护知识。

| 目录 | 回答的问题 | 正文归属 |
|---|---|---|
| [specs](specs/README.md) | 要做什么，怎样算完成？ | 用户问题、场景、业务规则、范围与验收条件；需要时在同一 spec 中记录目标结构和技术契约 |
| [changelog](changelog/README.md) | 做了什么，接下来做什么？ | 开发状态、计划、交付时间线与验证证据 |
| [architecture](architecture/README.md) | 系统怎样连接？ | 模块、接口、数据流、状态归属、失败与恢复边界 |
| [runbook](runbook/README.md) | 怎样操作和排障？ | 可复用步骤、诊断方法、成功信号与恢复办法 |
| [vendor](vendor/README.md) | 外部实现依据是什么？ | 选择性同步的源码、精确版本与来源 |
| [wiki](wiki/README.md) | 哪些人工知识值得保留？ | 中文理解、阅读笔记与探索性知识 |

## 开发维护流程

1. 确认需求：在 specs 记录问题、范围、验收条件与稳定 ID。
2. 登记计划：在 changelog 登记优先级和状态；准备实施复杂需求时再创建阶段计划。
3. 必要设计：可直接在 spec 记录实现所需的结构和技术契约，无须重复建立 design.md。architecture 保存当前架构说明、配套图示及独立专题；提案与当前实现分开标注。
4. 开发验证：代码和受影响的文档一起审查；不要求每次改动都更新六类文档。
5. 交付：changelog 保存实际变化、提交和验证证据；同步当前架构、操作说明及 README 中受影响的内容。

## 保持可靠

- 同一事实只维护一份正文，其他入口链接它。开发状态只维护在 changelog，需求和设计链接状态页。
- 当前架构只描述已实现行为；提案注明性质。已实现、已验证、已提交、已推送分别陈述；完成标记必须有验收证据。
- AGENTS.md 保持约 60 行以内，文件路径或验证入口变化时同步更新，不记录任务进度。
- 目录先建索引，有内容才建专题。每份新文档须从所属索引可达；迁移时修复引用。
- 历史文档和图注明时间与范围，不把旧验收结果当成当前运行状态。
- Agent 在开发/排障收尾自动评估知识沉淀，有可靠且可复用的结论时更新 Runbook/Wiki 及索引；不复制原始对话、不强行产出，用户本次只读约束优先。

## 规格与历史资料

自动维护遵循 [W-001](specs/project-workflow/spec.md)：手动 project-spec、提交前先 project-spec-review 再 project-change-sync、任务收尾 project-learning-sync。受管规格采用头部元信息，状态和双向关系见 [地图](specs/MAP.md)。操作见 [runbook](runbook/project-workflow.md)。

模型管理和 PDF 现行契约分别位于 [M-001](specs/model-provider-management/spec.md)、[F-001](specs/pdf-attachments/spec.md)。各专题 history 保存原提案、清单和评审记录，evidence 保存原始验证结果；历史实现进度进入 changelog。当前正文不与历史提案并列生效。

目录职责依据用户提供的文章摘录；architecture / runbook 的“8 类”定义尚待原文补充。collar-* 名称不代表本仓库已接入相应工具。
