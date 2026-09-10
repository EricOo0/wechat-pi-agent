# 面向会话的 Harness：建议架构

性质：设计提案。关联 [H-001 需求](../../../specs/agent-harness/requirements.md)；开发状态统一见 [计划](../../../changelog/planned.md#h-001-agent-harness)。

## 长程任务控制

Orchestrator 内增加 Goal Controller：保存目标版本、用户约束和里程碑，依据进展与验证结果决定继续、调整计划、等待唤醒、暂停、阻塞或完成。预算与停滞检测控制持续执行；Run 结束不等于 Goal 完成。

- Runtime 执行一次 Run，返回进展、产物证据与停止原因。
- Context Manager 保留最新目标、约束、里程碑、工作状态和证据引用，压缩或恢复后核对真实状态。
- Verification 执行约束、阶段与完成检查，返回通过、失败或无法确认。
- Goal / Task Store 保存目标版本、计划与检查点；Session Store 保存会话事件。任务工作状态与用户长期记忆分开管理。
- 恢复时核对外部副作用，不盲目重放工具调用；等待外部条件时挂起并按事件或受控检查唤醒。
- 用户可查看进度、证据与阻塞原因，修改目标、暂停、恢复或取消；长程执行不扩大授权范围。

[SVG 源图](assets/architecture.svg) · [PNG 预览](assets/architecture.png) · [SVG 生成脚本](assets/render_architecture.py)。脚本仅生成 SVG；调整源图后须重新导出 PNG 并检查两者一致。

边界：消息交互拥有渠道身份、接收去重、会话映射、输入附件和可靠投递；Orchestrator 拥有 Session 生命周期、输入路由、并发额度和运行控制；Runtime 维护 Agent Loop。上下文、Skills、记忆、文件产物、工具权限、执行环境和验证通过能力接口组合。

存储不是全局轮询调度中心。已接受输入和关键状态须有明确持久化确认，流式增量可异步记录。渠道 Inbox / Outbox、后台记忆任务仍可使用持久队列。每个 Session 的输入有序，跨 Session 并发有额度限制。

图中箭头是接口级主关系，并未穷举所有服务调用。组装、恢复时 Orchestrator 会访问 Session Store；记忆整理独立调用生成与存储能力。Verification 为按任务配置的检查能力，不承诺通过通用模型判定所有输出正确。远端执行环境是可扩展接口，不代表当前已接入远端沙箱。

参考：
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex Session 实现](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/mod.rs)
- [DSH 官方架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md)
- [DSH 会话持久化](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.zh.md)

本图是结合项目需求的设计建议，不是 Codex 或 DSH 的官方架构图。
