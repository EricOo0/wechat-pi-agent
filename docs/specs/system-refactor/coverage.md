# 现有功能覆盖与迁移验收

基线：2026-09-10 本地 src、test、README、package.json。此表表示设计归属已核对，不表示重新运行了测试或真实链路。[重构规格](spec.md) · [逐文件归属](source-map.md)

| 现有功能 | 目标归属 | 必须保留的行为与边界 | 已有测试依据（test 下） |
|---|---|---|---|
| 微信登录与接入 | cli + workers + messaging + ilink adapter | QR 登录、凭证、本地设置、长轮询、cursor、退避；白名单与可信主体 | contract/ilink-http-client.test.ts；unit/bootstrap/config.test.ts |
| 接收入库 | messaging + conversation + turns | 消息去重、Session 关联、Turn 入队与 cursor 原子提交 | unit/application/ingest-message.test.ts；integration/sqlite-control-plane.test.ts |
| 消息命令 | wechat 呈现 + 各模块应用服务 | /new、/status、帮助、权限、模型命令；未知/歧义命令和附带附件的管理文本仍交给 Agent | unit/application/command-router.test.ts；integration/model-switching.test.ts |
| 普通聊天与 Pi | turns + Agent Runtime + pi adapter | 模型工具循环、流式事件、thinking 配置、取消、Pi 历史定位与释放 | unit/application/run-next-turn.test.ts；integration/e2e-dry-run.test.ts |
| 可靠回复 | messaging + ilink adapter | 文本分段、typing、Outbox 租约、稳定 client_id、退避、死信；不承诺外部 exactly-once | unit/application/deliver-reply.test.ts；unit/application/reply-chunker.test.ts |
| Session 结束 | conversation + memory + permissions | /new、1 小时闲置、分钟扫描、排队消息迁移、旧续跑取消、权限清理补偿 | integration/memory-runtime.test.ts；integration/service-shutdown.test.ts |
| 应用上下文 | context + conversation + pi adapter | 系统提示词、历史、压缩；PDF 回执立即入上下文、失败后补录、去重重放 | unit/pi/conversation-context.test.ts；integration/memory-context.test.ts |
| Skills | skills + context + tools + pi adapter | 加载开关、来源优先级、自然语言 read、/skill 显式展开、错误反馈、skill_load Trace；扩展/主题/自动上下文禁用规则 | unit/pi/skill-catalog.test.ts；unit/pi/skill-loader.test.ts；unit/pi/system-prompt.test.ts |
| 图片输入 | artifacts + ilink adapter + pi adapter | JPEG/PNG/GIF/WebP、解密、原图/缩略图回退、数量/大小限制、视觉能力校验；当前下载在发送者过滤前，顺序改变需单独评审 | contract/ilink-image-update.test.ts；unit/ilink/image-downloader.test.ts |
| PDF 文件库 | artifacts + filesystem/sqlite/ilink adapters | 按用户归属、原件跨 Session 保留、配额、哈希、类型校验；file_list、file_use；选择仅本 Turn 有效 | integration/user-files.test.ts；unit/files/codex-file-input.test.ts |
| 模型文件输入 | artifacts + models + codex-files adapter | 官方 Codex PDF 原件上传、账号隔离远端 ID、短期链接缓存与刷新、远端缺失重传；不持久化签名链接 | unit/files/codex-file-input.test.ts；unit/files/redact-file-errors.test.ts |
| 文件错误与能力边界 | artifacts + messaging | 纯上传可直接回执，不调用模型；分析失败不删原件；微信当前只回文本，不新增产物回传 | integration/user-files.test.ts；unit/application/run-next-turn.test.ts |
| 长期记忆读取 | memory + context | 新 Session 固定总览快照；memory_search 字面检索和 memory_read 按行读取；用户隔离与输入预算 | integration/memory-context.test.ts；integration/memory-system.test.ts |
| 后台记忆生成 | memory workflow + worker + pi adapter | 归档与入队同事务、明细提炼/总览合并、租约重试、同用户顺序、版本冲突重试、无聊天工具 | integration/memory-runtime.test.ts；integration/memory-system.test.ts；unit/memory/redaction.test.ts |
| 权限主体与申请 | permissions + wechat/admin 入口 | 可信用户、executor/workspace/session 作用域；永久/会话/一次性授权；确认/拒绝/撤销、一次尝试消费、审计 | unit/permissions/permission-service.test.ts；integration/permission-flow.test.ts |
| 即时权限控制 | permissions + turns + Agent Runtime + execution | 入库后即处理可信权限命令，长 Run 中撤销及时中止执行；回执去重；不能仅排进普通任务队列 | integration/permission-flow.test.ts；integration/managed-tools.test.ts |
| 授权续跑 | permissions + turns + conversation | 确认后原子创建去重 continuation；执行前重查会话/权限；旧 Session 不跨重启续跑 | integration/permission-continuation.test.ts |
| 普通工具 | tools + permissions + execution | read、list_files、sandbox_write、http_get、bash、permissions_get、permissions_request；HTTPS GET 不跟随重定向；命令超时 | integration/managed-tools.test.ts；unit/permissions/policy-compiler.test.ts |
| 沙箱与 Full Access | execution + sandbox adapter | 默认工具限制、受保护路径、初始化失败拒绝执行、Seatbelt/bubblewrap；显式 Full Access、受管取消与清理；不能回滚既有副作用 | local-sandbox-executor.test.ts；integration/managed-tools.test.ts |
| 模型选择 | models + turns + pi adapter | auth-before-model、subjectKey 持久选择、每 Turn 固定绑定、切换保留历史、不自动 fallback、功能开关 | integration/model-switching.test.ts；unit/models/model-management.test.ts |
| Provider 认证与换号 | models + admin + model adapters | OAuth/API Key、本机控制令牌/Host/Origin、暂存凭证、排空聊天/记忆/文件请求后提交、认证版本、失败隔离、旧任务不能换号重做 | integration/model-admin.test.ts；unit/models/provider-authentication.test.ts |
| 认证兼容与引导 | cli + models adapter | Pi 固定版本 AuthStorage 内部桥接、原生锁、初次模型选择、非交互启动错误；不把认证就绪等同模型可访问 | unit/models/provider-authentication.test.ts；unit/bootstrap/config.test.ts |
| Trace 与 Admin | observability + admin + telemetry/sqlite adapters | Session/Turn 树、聊天视图、模型实际 payload/usage/reasoning、工具 ID、文件/Skill/上下文/记忆事件；脱敏、截断、保留策略 | integration/admin-traces.test.ts；unit/trace-model.test.ts；unit/reasoning-view.test.ts；unit/pi/model-call-trace.test.ts |
| 运维查询 | observability + admin | healthz、readyz、metrics、debug/traces、debug/turns、recent-errors、memory/jobs；模型管理审计 | unit/observability/metrics.test.ts；integration/admin-traces.test.ts；integration/model-admin.test.ts |
| 进程生命周期 | bootstrap + workers + modules | 单实例锁、数据库迁移、先绑定端口再恢复、停止领取、30 秒收尾后取消、归档与关闭；恢复 Outbox/记忆，取消遗留 Turn | integration/service-shutdown.test.ts；unit/application/recover-interrupted-work.test.ts |
| Dry Run 与构建 | dry-run adapters + bootstrap + scripts | 不访问微信/模型的确定性替身；提示词和沙箱 worker 随构建复制；Node 版本、配置和启动命令 | integration/e2e-dry-run.test.ts；unit/bootstrap/config.test.ts；package.json |

## 数据兼容清单

app.db、permissions.db、files、inbound-media、memory、pi-sessions、credentials/ilink.json、settings.json、executor-id，以及用户 Pi auth/models 文件的职责全部保留。此次架构不要求移动运行数据，不提交凭证或私有对话。

实现迁移须明确：旧 Session/Turn/Outbox ID、Trace 查询、Pi 历史引用、用户 subjectKey、模型账号作用域、权限执行器身份和 memory job 阶段如何保持兼容。拆分 Repository 不能破坏接收入库、任务完成和会话归档的既有事务。

## 验收口径

上表是源码和既有测试文件对应关系；测试名字不是全部边界都已覆盖的保证。重构实施时为有行为风险的边界补充验证。真实微信、真实 OAuth/API Key、PDF 模型链路、Linux 沙箱的验收与本地自动化结果分别报告。

新增 Workflow Graph 只改变流程表达和执行机制；跨重启恢复权限等待、工具级精确续跑、自动目标推进不因引入检查点而自动成为本次功能。
