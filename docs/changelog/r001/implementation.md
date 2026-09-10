# R-001 实施记录

基线提交：6aa38c907641508c1f9cba27a9b9d29b57cbd3ae。此记录只说明本地工作区，尚未提交、推送或重启服务。

## 规格检查与决策

核对 R-001、26 项功能覆盖和原 109 文件归属。当前明确不引入 Graph、checkpoint 或通用进程恢复；模块化、存储端口、认证分层等改造保留。

## 实现

- 迁移原代码到 modules、entrypoints、runtime、workers 和按外部依赖组织的 adapters，移除全局 application/use-cases/domain 目录。模块跨域使用公开 index，静态约束进入 check。
- 拆分 MessageStore、DeliveryStore、TurnStore、ConversationContextStore、TraceQuery、RecoveryStore；保持数据库 schema、ID 和关键事务。
- Turn 和记忆整理使用普通应用编排；Pi 运行由 Agent Runtime 包装，保留现有中断和后台重试策略。
- 拆出 ProviderAuthService/AuthBackend/AuthOperationStore；保留隔离候选凭证、排空、提交 journal、版本递增及不确定提交隔离语义。
- 抽出 Tool 执行、FileLibraryService、ReplyPresentation、Skill 排序和应用上下文渲染能力；协议适配器负责 SDK 转换。
- 提取后台启停与闲置 Worker；更新 CLI、构建复制及真实验证脚本的源码路径。

## 验证与边界

基线：122 个测试及 lint/typecheck/build 通过。新验证原始输出存于 [证据目录](../../specs/system-refactor/evidence/README.md)。

旧文件回执测试曾同时领取同一会话两轮以构造未来事件；已改为先断言不能重复领取，再完成当前轮并创建后续回执，保持“不能重放未来回执”的原检查目标。

此轮只执行本地自动化、真实本机沙箱和隔离数据库验证；没有重新进行真实微信、OAuth/API Key、PDF 模型调用或 Linux 沙箱验收。没有运行 Go 检查，没有修改用户数据、凭证或服务运行配置。

原路径迁移见 [机器可读映射](source-moves.json)；新代码和测试的最终 SHA256 随最终检查结果记录。具体条款核对见 R-001 的 reviews。
