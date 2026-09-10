# 业务需求地图

维护目标、使用场景、范围、业务规则和验收条件；进度统一见 [变更与计划](../changelog/README.md)。

先读 [规格状态地图](MAP.md) 判断是否现行。新规格的类型、生效状态和双向关系遵循 [W-001](project-workflow/spec.md)，用 project-spec 手动创建。

| 能力 | 需求或现有说明 |
|---|---|
| W-001 项目文档自动维护 | [规格与 Hook 契约](project-workflow/spec.md) |
| R-001 系统模块化与工作流重构 | [唯一规格正文](system-refactor/spec.md) · [功能覆盖](system-refactor/coverage.md) · [文件归属](system-refactor/source-map.md) |
| 微信消息与回复、权限与工具 | [当前能力与使用说明](../../README.md) |
| M-001 模型与认证管理 | [现行规格](model-provider-management/spec.md) |
| F-001 用户文件与 PDF | [现行规格](pdf-attachments/spec.md) |
| 用户记忆 | [运行说明](../user-memory.md) |
| H-001 Agent Harness | [需求草案](agent-harness/requirements.md) |

新需求采用独立目录和稳定 ID，至少写清：问题与场景、目标、范围、验收条件、待决策问题、关联设计和状态入口。既有能力先链接已有资料，按需补独立 spec。

R-001 将结构设计与验收合并在一个 spec 中，不另维护同内容的 design；其图片与生成材料通过 architecture 图示索引管理。
