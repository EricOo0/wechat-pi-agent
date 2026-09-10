# 系统重构图示

唯一规格正文：[R-001 系统模块化与工作流重构](../../../specs/system-refactor/spec.md)。原 design.md 已合并为该 spec，不维护第二份正文。

- [架构 PNG](assets/architecture.png)
- [完整图像提示词](assets/architecture.prompt.txt)
- [功能覆盖表](../../../specs/system-refactor/coverage.md)
- [逐文件迁移归属](../../../specs/system-refactor/source-map.md)

图是重构目标，非当前实现。图中 Tasks 对应 spec 的 turns（现有轮次执行）；“能力应用服务”指文件、记忆、模型、权限等独立服务。Conversation 管顺序与生命周期，Turns 统一管理运行所有权。工作流引擎仍待选型，Harness 后置。

PNG 来自内置图像工具，保留生成时的原始提示词；标签精确含义以 spec 为准。
