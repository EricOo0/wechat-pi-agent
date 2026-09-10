# 模块技术架构图

依据：c7ed9e9 源码。内置 image_gen 生成，不指定或核验具体图像模型。

按业务职责展示现有代码；不是目录重构或独立服务拆分。Bootstrap 是组合根和运行管理入口，管理页是旁路查询入口。业务模块通过应用接口使用存储、模型和执行适配器。

## 提示词

Create a NEW technically accurate Chinese software architecture image. Use case infographic-diagram. Landscape large readable high resolution, white background, navy title, restrained teal/blue/purple/orange module cards. Title “微信 × Pi Agent：模块与技术架构”. Subtitle “按业务职责划分模块，模块内标明调度、用例、领域模型与技术实现”. This is a module architecture, not a generic horizontal layered flowchart. NO generic 领域层 row. NO Bootstrap inside inbound. All modules are logical modules of the same Node.js TypeScript service, not separate services.

At top a separate wide grey bar, OUTSIDE business module groups, labelled:
“启动与运行管理 · Bootstrap”
“加载配置 / 认证 → 创建组件并注入依赖 → 启动 HTTP 与后台循环 → 退出收尾”
“Node.js 22 · TypeScript · 手动依赖注入 · proper-lockfile 单实例锁”
No arrows from Bootstrap through business stages; its scope is lifecycle and wiring.

Main region has three equal large columns, numbered 1-3:
1 teal “消息接入”
“驱动：PollLoop”
“用例：IngestMessage”
“职责：发送者校验 / 消息去重 / Session 关联 / Turn 入队”
“领域：InboundMessage”
“适配：ILinkHttpClient（fetch 长轮询）”
“存储：Inbox + cursor + 待执行 Turn”
Small note “入库与 cursor 推进同事务；权限控制可即时生效”.

2 blue “任务执行”
“驱动：TurnWorkerLoop（单 worker 串行）”
“用例：RunNextTurn”
“职责：原子领取 / 命令与文件处理 / 调用 Agent / 保存结果”
“领域：Turn / Step”
Within this column a clearly nested runtime box:
“Agent 接口 → PiAgentGateway”
“pi-coding-agent：会话 / Skills / 压缩”
“pi-agent-core：模型与工具循环”
“pi-ai：Provider 协议 / 模型流”
Small caption “需要推理时调用 Agent；纯上传回执无需请求模型”.
“输出：Turn 结果 + Outbox”
No imply RunNextTurn equals agent runtime.

3 orange “回复投递”
“驱动：OutboxWorkerLoop”
“用例：DeliverReply”
“职责：领取待发回复 / 发送 / 记录结果 / 失败重试”
“领域：OutboxMessage”
“适配：Channel → ILinkHttpClient（fetch）”
“存储：Outbox / 发送状态 / 下次重试时间”
Small note “所有回复经 Channel 发送到微信”.
Use NO arrows between these 3 cards; a tiny single text caption underneath them explains “模块间通过 SQLite 中的 Turn / Outbox 持久队列衔接”. This avoids confusing direct synchronous calls.

Below main columns a row of THREE supporting capability panels, also with their own domain label:
LEFT “会话与用户记忆”
“领域：Session / UserMemory / MemoryJob”
“生命周期：EndSession + Idle 扫描”
“/new · 闲置 1 小时 · 退出 / 启动恢复”
“结束归档 + memory_jobs 入队同事务”
“后台：MemoryWorkerLoop → GenerateSessionMemory”
“PiMemoryGenerator（pi-ai，无工具）提炼 / 合并”
“MemoryStore 原子写入：明细 + MEMORY.md”
“新会话加载总览；Agent 调用 memory_search / memory_read”
“SQLite 阶段 / lease / 重试；Markdown 正文；无 embedding”.

CENTER “权限与工具执行”
“领域：授权 / 申请 / 权限主体”
“真实用户确认 → PermissionService → PolicyCompiler”
“用户 / 执行器 / 工作区 / Session 作用域”
“一次 / 会话 / 长期授权；执行前校验；撤销取消”
Draw a distinct inner dashed box labelled “工具子进程 · OS 沙箱”
inside “LocalSandboxExecutor 派生 supervisor / tool-worker”
“@anthropic-ai/sandbox-runtime”
“macOS Seatbelt · Linux bubblewrap”
“目录与网络限制 · 超时 / 取消”
Below dashed box “Full Access：显式使用当前 OS 用户权限”
Note “微信与模型网络由主服务控制面执行”.

RIGHT “用户文件与模型附件”
“领域：UserFile / 模型文件引用”
“保存：SaveInboundFiles”
“查询与选用：file_list / file_use”
“存储：本地原件 + SQLite 用户索引”
“PDF 适配：CodexFileInput / onPayload”
“远端 ID 持久化；短期 file_url 缓存”
“Agent 按用户访问文件；当前 PDF 接入 Codex”
A distinct small external badge “外部模型服务 · 默认 Codex” with caption “由 pi-ai / 文件适配器访问”. Do not put provider inside the sandbox.

Bottom full-width foundation divided 3 cards:
“公共持久化适配器” with “node:sqlite：app.db / permissions.db” and “node:fs：文件 / Pi JSONL / 用户记忆”.
“管理与观测（旁路）” with “浏览器打开 /admin → AdminServer（node:http）” and “查询 Session / Turn / 模型 / 工具 / 记忆 Trace” and “Pino 日志 · prom-client 指标”.
“架构约定” with “应用用例通过接口访问适配器” and “Bootstrap 负责组装，不参与逐条消息处理” and “图示为职责视图，仍是单进程模块化服务”.

Arrows only within explicitly requested short collaborator paths. No arrows from Admin to workers, no vertically stacked fake DDD layers, no direct RunNextTurn to WeChat, no generator to memory tools. Use compact but sufficiently large type; let longer cards have more height. Keep every named framework accurate; versions can be omitted. No decorative icons taking text space.
