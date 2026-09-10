# 业务规格

这里记录系统要实现的行为、边界和验收条件。开发状态与下一步统一查看 [变更与计划](../changelog/README.md)，实现连接关系查看 [系统架构](../architecture/README.md)。

## 规格入口

| 主题 | 当前契约 |
|---|---|
| R-001 系统模块化与工作流重构 | [现行规格与验收](system-refactor/spec.md) |
| W-001 项目规格与知识维护自动化 | [现行规格](project-workflow/spec.md) |
| M-001 模型与认证管理 | [现行规格](model-provider-management/spec.md) |
| F-001 用户文件与 PDF | [现行规格](pdf-attachments/spec.md) |
| F-002 截图与微信图片回传 | [规格与实现核对](image-delivery/spec.md) |
| 用户记忆 | [运行说明](../user-memory.md) |
| H-001 通用 Task 执行与控制 | [规格与验收](agent-harness/spec.md) |

新需求采用独立目录和稳定 ID，至少写清：问题与场景、目标、范围、验收条件、待决策问题、关联设计和状态入口。既有能力先链接已有资料，按需补独立 spec。

R-001 将结构设计与验收合并在一个 spec 中，不另维护同内容的 design；其图片与生成材料通过 architecture 图示索引管理。

- [H-002 Task Trace 整合](task-trace/spec.md)：H-001 可观测性扩展。
