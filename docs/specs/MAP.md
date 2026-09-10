# 规格状态地图

由 `workflow.py specs-sync` 生成。status 表示变更阶段，lifecycle 表示能力状态；没有发布证据不能从 accepted 推断已上线。

| ID | 规格 | 类型 | 成熟度 | 阶段 | 能力状态 | 影响 | 后续变更 |
|---|---|---|---|---|---|---|---|
| F-001 | [用户 PDF 文件库与模型文件输入](pdf-attachments/spec.md) | feature | stable | accepted | active | — | F-002 |
| F-002 | [截图与微信图片回传](image-delivery/spec.md) | feature | experimental | implemented | planned | F-001, H-001, R-001 | — |
| H-001 | [通用 Task 执行与控制](agent-harness/spec.md) | feature | experimental | implemented | planned | R-001, M-001 | F-002, H-002 |
| H-002 | [Task 维度 Trace 整合](task-trace/spec.md) | patch | experimental | implemented | planned | H-001 | — |
| M-001 | [模型、供应商与认证管理](model-provider-management/spec.md) | feature | stable | accepted | active | — | H-001 |
| R-001 | [系统模块化与工作流重构](system-refactor/spec.md) | feature | stable | implemented | planned | — | F-002, H-001 |
| W-001 | [项目规格与知识维护自动化](project-workflow/spec.md) | feature | experimental | implemented | planned | — | — |
