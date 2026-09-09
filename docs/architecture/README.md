# 系统架构地图

## 当前实现

- [系统概览与源码依据](current-system-2026-09-09.md) · [PNG](current-system-2026-09-09.png)
- [模块职责详细说明](layered-architecture-v3.md)
- [启动与依赖组装](../../src/bootstrap/container.ts)
- [模型管理专题设计](../designs/model-provider-management/design.md)
- [PDF 专题设计](../designs/pdf-attachments/design.md)

已有日期图表示对应源码基线，后续行为变化须同步相关说明。旧版图片与提示词保留用于追溯，不自动视为当前架构。

## 设计提案

- [H-001 需求](../specs/agent-harness/requirements.md) → [Harness 提案](proposals/agent-harness/design.md)
- [提案 SVG](proposals/agent-harness/architecture.svg) · [PNG](proposals/agent-harness/architecture.png) · [绘图脚本](proposals/agent-harness/render_architecture.py)

## 维护方式

连接关系记录调用方、被调用方、接口或源码位置、状态和数据归属、失败与恢复行为。
当前说明与提案明确区分；进度查 changelog，业务目标查 specs。
既有当前图先保留原路径；未来按专题整理到 `current/` 时同步修复引用，不先创建空目录。

文章中的“8 类连接点”定义尚未提供，暂不自行命名八类。
