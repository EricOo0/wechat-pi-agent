# 规格状态地图

由 `workflow.py specs-sync` 生成。status 表示变更阶段，lifecycle 表示能力状态；没有发布证据不能从 accepted 推断已上线。

| ID | 规格 | 类型 | 成熟度 | 阶段 | 能力状态 | 影响 | 后续变更 |
|---|---|---|---|---|---|---|---|
| F-001 | [用户 PDF 文件库与模型文件输入](pdf-attachments/spec.md) | feature | stable | accepted | active | — | — |
| H-001 | [Agent Harness](agent-harness/requirements.md) | feature | experimental | draft | planned | — | — |
| M-001 | [模型、供应商与认证管理](model-provider-management/spec.md) | feature | stable | accepted | active | — | — |
| R-001 | [系统模块化与工作流重构](system-refactor/spec.md) | feature | stable | implementing | planned | — | — |
| W-001 | [项目规格与知识维护自动化](project-workflow/spec.md) | feature | experimental | implementing | planned | — | — |
