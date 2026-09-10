# Task 操作与迁移排障

适用：H-001 / SQLite migration 9，2026-09-10 本地验证。真实部署尚待验收。

## 日常操作

- 微信 `/task status` 查看进度、状态、用量、等待或停止原因；`/task list` 查看当前会话历史。
- `/task pause` 停止推进，`/task resume` 使用剩余预算继续；用量耗尽时 `/task budget 10` 明确增加 10 次执行模型调用并继续暂停任务。重复投递同一控制消息不会重复加预算。
- `/task cancel` 终止当前任务，已产生的外部效果不回滚。命令单独发送；附带附件按普通输入处理。
- WAITING 时直接答复，文本/文件关联当前任务；PAUSED 时新输入被保留，仍需显式继续。JSON 无效或执行/Review 异常会暂停，可在 Trace 查看原因后决定继续或取消。
- `/admin/tasks` 查看任务；`/debug/tasks/:id` 查询输入、事件、运行关联。沿用本机 Admin 访问边界，不直接暴露公网。
- `/new` 关闭旧会话及其未完成 Task。重启只保留历史，不能用 resume 跨会话恢复。

成功信号：普通任务经过 Review 才 COMPLETED；等待不增长 reactUsed；预算到顶转 PAUSED；暂停/取消收尾后无新执行调用。真实模型的 JSON 遵循程度和 Review 质量需真实账号验收。

## 升级与迁移

停止服务后备份完整数据库及相关数据目录，再启动新版本；不要在运行写入时只复制 app.db 而忽略 SQLite WAL。保留与备份匹配的旧代码版本。迁移后不要直接用旧版本写新数据库；需要回退时停止服务并恢复升级前的完整备份。

本次仅对临时测试数据库执行 migration 9，未迁移用户运行数据。迁移测试从带数据的 v8 库验证旧 Turn/Step/Outbox ID、rowid 顺序、外键关联及重复迁移。

## 已验证的开发故障

症状：内部继续任务未创建下一 Turn。根因是原 turns.inbox_id 全局唯一，多个内部请求共享真实来源时冲突；INSERT OR IGNORE 会掩盖问题。修复为重建 Turns、仅 user_message 使用部分唯一索引，内部请求以独立 ID/source 去重，不伪造 Inbox。

重建被外键引用的表时，在事务开始前暂时关闭外键动作，事务内显式复制 rowid 和旧字段、重建索引并执行 foreign_key_check，失败回滚，最终恢复外键检查。只在事务内设置 foreign_keys 不足以保护重建过程。

另一个已验证问题是把内部继续请求的源 Inbox 文本再次作为用户发言交给 Memory。现在通过 source/input_text 标识内部输入，保留执行结果而不重复归因给用户。

依据：[迁移回归](../../test/integration/task-migration.test.ts)、[Task/事务/Memory 回归](../../test/integration/tasks.test.ts)、[完整运行证据](../specs/agent-harness/evidence/README.md)。Wiki 本轮无独立新增专题，机制与约束引用架构和规格，避免重复维护。

## Trace 排查入口（H-002）

打开 `/admin` 选择 Task；先看状态/预算和最新输入，再沿时间线查看 Run 的结构化结果、Review 缺口与投递状态。`/admin/traces` 保留历史及记忆记录。用量显示不完整时检查调用快照保留情况，不把已知 Token 合计当作全任务准确用量。

本次聚合测试发现 SQLite 查询返回的 Turn/Outbox 时间是 Date，而 Task Event 时间是字符串；投影层统一转 ISO 后排序，避免运行时 localeCompare 错误。回归覆盖真实 SQLite 投影与发送前后状态。没有额外 Wiki 主题需要重复沉淀。
