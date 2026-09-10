# 系统架构地图

架构材料按当前实现、提案图示和历史归档组织。图片、SVG、提示词和渲染脚本放在对应专题的 assets 中；早期图稿整体归档。重构约束以 spec 为准。

| 分区 | 入口 | 用途 |
|---|---|---|
| 当前实现 | [2026-09-10 模块化与工作流](current/2026-09-10/README.md) | 本地已实现的当前结构，部署状态另记 |
| 重构前基线 | [2026-09-09 系统说明](current/2026-09-09/current-system-2026-09-09.md) | 已实现结构及源码依据，非目标架构 |
| 系统重构图示 | [图示与标签说明](proposals/system-refactor/README.md) | 配合 [R-001 spec](../specs/system-refactor/spec.md) 阅读 |
| Task / Harness 扩展 | [Task 接入图](proposals/agent-harness/task-architecture.md) | 本地已实现；[当前运行边界](current/2026-09-10/task-runtime.md)，图示保留设计阶段标签 |
| 历史图稿 | [归档索引](archive/README.md) | 保留旧分层图、草图和生成材料，不能作为当前规格 |

## 其他架构依据

- [启动与依赖组装](../../src/bootstrap/container.ts)
- [模型管理专题](../specs/model-provider-management/spec.md)
- [PDF 专题](../specs/pdf-attachments/spec.md)

## 维护规则

当前架构只描述已实现事实；spec 规定目标、技术边界和验收。R-001 不另维护重复 design；图片是说明材料，发生差异以 spec 为准。进度与证据写入 [changelog](../changelog/README.md)。历史方案保留其原有身份，不因整理被标为现行设计。
