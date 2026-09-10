# 下一步与当前状态

## W-001 项目自动维护

- 四个 Skill、Git pre-commit 与 Codex 收尾脚本已实现；提交前先核对规格实现，再同步文档；验证结果见月度记录。
- 本机 Git Hook 已安装；Codex 的两个项目 Hook 待在 /hooks 首次信任。后续新会话可发现项目 Skill。
- [规格](../specs/project-workflow/spec.md) · [安装与操作](../runbook/project-workflow.md)。主项目未提交或推送。

## R-001 系统架构重构

- 优先顺序：先于 H-001 Harness。
- 状态：架构方向已确认，已形成统一 spec；引擎选型和原子提交接口待细化，业务重构尚未开始。
- [R-001 规格](../specs/system-refactor/spec.md) · [功能覆盖](../specs/system-refactor/coverage.md) · [逐文件归属](../specs/system-refactor/source-map.md)
- 已确认：先理清全系统职责，按领域模块组织，工作流采用状态机与 Graph 思路；适配层负责外部协议和存储映射。
- 下一动作：完成 spec 第 12 节的引擎/Pi/事务接口决策，再制定分阶段实施计划。
- 本次不引入 Goal Controller 或自动目标续跑；不把 Workflow 检查点等同 Pi 内部精确 resume。

## H-001 Agent Harness

- 优先顺序：系统架构重构完成后。
- 状态：后置，范围仍待澄清。
- [需求草案](../specs/agent-harness/requirements.md) · [技术提案](../architecture/proposals/agent-harness/design.md)
- 已确认：Harness 为后续扩展方向，当前先完成系统结构重构。
- 待明确：首期真实场景、范围、预算与停滞规则、验收条件。
- 下一动作：选择真实任务，确认首期边界后拆分可独立验收的阶段。
- 尚未开始功能实施；现有图中的模块属于候选设计。

范围确定后再建立阶段计划，不提前把所有设计模块变成必做任务。
