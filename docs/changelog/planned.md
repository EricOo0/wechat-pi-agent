# 下一步与当前状态

## F-002 截图与微信图片回传

- 状态：implemented。本地实现与完整检查通过；未提交、推送或部署，运行服务未重启。
- 统一 reply_image(path) 保存图片快照；Task Review/版本门槛后入 Outbox；iLink 上传、私有媒体引用、续租/有序重试已接入。
- 截图复用项目 screenshot-reply Skill，短 TMPDIR 修复已用真实空白网页验证；不新增截图原生工具。
- [规格与核对](../specs/image-delivery/spec.md) · [验证证据](../specs/image-delivery/evidence/README.md) · [启用与排障](../runbook/image-replies.md)。
- 下一步：服务加载新代码后，在明确测试范围验证实际宿主桌面权限及真实微信可打开图片。已登录网页会话与媒体 TTL/远端去重仍有外部边界。

## W-001 项目自动维护

- 四个 Skill、Git pre-commit 与 Codex 收尾脚本已实现；提交前先核对规格实现，再同步文档；验证结果见月度记录。
- 本机 Git Hook 已安装；Codex 的两个项目 Hook 待在 /hooks 首次信任。后续新会话可发现项目 Skill。
- [规格](../specs/project-workflow/spec.md) · [安装与操作](../runbook/project-workflow.md)。主项目未提交或推送。

## R-001 系统架构重构

- 优先顺序：先于 H-001 Harness。
- 状态：implemented。本地重构与 123 个测试等检查已完成，已提交并推送 e3e934f；未部署，真实运行验收待完成。
- [R-001 规格](../specs/system-refactor/spec.md) · [功能覆盖](../specs/system-refactor/coverage.md) · [逐文件归属](../specs/system-refactor/source-map.md)
- 已确认：先理清全系统职责，按领域模块组织，业务流程使用普通应用服务与明确状态转换；适配层负责外部协议和存储映射。
- 实施：引擎/Pi/事务接口决策已落实，见 [记录](r001/implementation.md)。真实微信/认证/模型输入验收单列，不以本地测试代替。
- 本次不引入 Goal Controller 或自动目标续跑；不引入 Graph、checkpoint 或通用进程恢复。

## H-001 Agent Harness

- 状态：implemented。本地实现及 146 个测试、架构检查、Lint、类型检查、构建通过；尚未提交、推送或部署。
- 普通聊天统一 Task；同会话最多一个未关闭 Task；最终 JSON、完成申请 Review、累计 30 轮与明确追加预算已接入。
- 暂停/取消、权限续跑、版本过期保护、文件 HITL、管理查询和 SQLite migration 9 已实现。
- [规格与核对](../specs/agent-harness/spec.md) · [证据](../specs/agent-harness/evidence/README.md) · [操作](../runbook/tasks.md)。
- 下一步：真实微信、真实模型 JSON/Review 和 PDF 输入验收；部署前备份数据库。未引入 Graph/checkpoint/跨进程续跑。

## H-002 Task Trace

- implemented：统一 Task 管理视图及聚合查询完成，148 个测试及浏览器合成数据验证通过。
- [规格与核对](../specs/task-trace/spec.md)。真实运行验收待完成，未提交、推送或部署。
