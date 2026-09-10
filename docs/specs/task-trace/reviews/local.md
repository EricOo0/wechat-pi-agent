# H-002 本地完成核对

stage=completion；implementation_ready=true。核对未提交工作区；暂存指纹不适用，不替代后续 pre-commit 核对。基线及源码文件 SHA256 见[证据](../evidence/local-check.json)。

| 条款 | 结论 | 代码 / 已运行证据 |
|---|---|---|
| H-002-1 | conforms / local | task-trace.ts 先经 TaskManager.details 可信 owner 检查，再读取各 Turn；tasks.test.ts 验证其他 owner 无查询和数据泄露 |
| H-002-2 | conforms / local | task-page.ts 与 TaskRoutes；Playwright 验证分组、筛选、空态和三栏详情，输入只通过 textContent 渲染 |
| H-002-3 | conforms / local | TaskManager 持久化 task_run_context/task_outcome；PiTaskReviewer 写 phase/完成申请/版本；聚合分离 Review 与原模型工具 spans |
| H-002-4 | conforms / local | TaskStore 控制事件保存前后状态与预算，过期事件关联 Turn；控制请求可查但无 Agent 证据不标 Run；集成覆盖控制与 Run 数量 |
| H-002-5 | conforms / local | task-trace 用量按执行/Review 分组；单元测试验证 10+20 与缺失标志；集成验证 COMPLETED/PENDING 和发送后 SENT，内部发布状态独立 |
| H-002-6 | conforms / local | 原 /admin/traces 与 /debug/traces 保留；148 测试、45 文件及完整检查通过，迁移和旧 Trace 回归保留 |

关联 H-001-2/11/13 本地回归通过。未改变执行协议、30 轮限制或恢复边界；原 H-001 证据属于旧版本，本次完整检查覆盖当前版本。

无本地 missing/deviates。部署与真实微信/模型运行属于 external/unverified，不声明 effective。页面截图使用合成数据；不是用户真实任务截图。历史快照若被原保留策略裁剪则显示未记录，Task 汇总计数保留，用量不冒充完整。

源文件： [聚合](../../../../src/modules/tasks/application/task-trace.ts)、[页面](../../../../src/entrypoints/admin-http/task-page.ts)、[路由](../../../../src/entrypoints/admin-http/task-routes.ts)。测试：[聚合单测](../../../../test/unit/tasks/task-trace.test.ts)、[任务集成](../../../../test/integration/tasks.test.ts)。

[核对规格指纹](spec-fingerprint.json)。

## 阅读体验核对

H-002-2/3/4 conforms / local：运行事件关联明确 turnId，Review 开始/结论合并且原始 lifecycle 保留；历史匹配不唯一时保留原事件。单元测试检查 Review 合并，任务集成仍通过。JSON 树按需展开并使用 textContent；Chrome 验证缩放、展开、弹窗及 Esc 还原，148 项完整检查通过。[最新版本证据](../evidence/ux-check.json)。未部署。
