# 技术架构图生成说明

依据：当前提交 c7ed9e9 的源码及 package.json。生成方式：内置 image_gen；工具不提供模型选择或具体模型核验参数。

产物：technical-architecture.png。此图展示技术分层、组件与执行边界，消息流程见 system-architecture.png。

图中纵向箭头表示层间关系，不是逐函数调用；五个循环由 Bootstrap 启动，Admin HTTP 提供查询接口。领域和接口由出站适配器实现，不表示领域代码依赖具体适配器。LocalSandboxExecutor 是主进程中的执行入口，虚线框内 supervisor / tool-worker 才是派生子进程。

最终生成后校对：管理浏览器连接 Admin HTTP，模型调用标记为控制面网络；普通工具沙箱与主服务分开，记忆生成不调用搜索工具。

## 编辑提示词

Preserve the diagram, but connect 管理浏览器 to Admin HTTP instead of Bootstrap; place the model Provider outside the main service boundary and label its Pi connection 控制面模型网络; remove the floating network badge beneath storage; change 领域模型（聚合） to 领域模型（状态）; spell ILinkHttpClient correctly. Preserve technical labels and readable Chinese typography.

## 提示词

Use case: infographic-diagram. Create a polished Chinese TECHNICAL LAYER ARCHITECTURE diagram, NOT a message sequence flowchart. Large high-resolution landscape canvas, crisp legible Chinese and English sans-serif typography, white background, navy headings, subtle teal/blue/purple/orange layer colors, thin straight labeled arrows. Title “微信 × Pi Agent 技术架构”. Subtitle “Node.js 22 + TypeScript · 单实例模块化服务 · 接口与适配器分层”. Prioritize accuracy and spacious technical hierarchy over decorative icons.

Layout: a large LEFT area (roughly 70% width) with FOUR stacked horizontal architecture layers, and a RIGHT sidebar (30%) with TWO large technical detail panels. Bottom full-width persistence/observability foundation. Layers are nested within a labeled “主服务进程 · Node.js” boundary. The sandbox child-process box in right sidebar is OUTSIDE this main process boundary. Give each layer a colored left label and 2-3 readable component cards.

LAYER 1 “接入适配层 · inbound”
Card1 “PollLoop / iLink” and “长轮询接收 · 原生 fetch”.
Card2 “Admin HTTP” and “node:http · Tree / Chat / Debug API”.
Card3 “Bootstrap” and “手动依赖注入 · proper-lockfile”.
Small external badges above the layer: 微信 iLink and 管理浏览器. Short arrows connect to corresponding inbound cards.
LAYER 2 “应用编排层 · Orchestration（自研）”
Card1 “IngestMessage / RunNextTurn / DeliverReply” and “消息去重 · Turn 状态机 · Outbox 重试”.
Card2 “5 个异步循环” with “Poll / Turn / Outbox / Memory / Idle”.
Card3 “EndSession / GenerateSessionMemory” and “归档入队同事务 · 1 小时闲置结束”.
Below cards exact clear annotation “SQLite 持久队列 + 原子领取 / lease；单个 Turn worker 串行执行；记忆 worker 独立运行”.
This is application scheduling, not a distributed workflow framework.
LAYER 3 “领域与接口 · domain / application interfaces”
Compact domain strip “Session · Turn · Outbox · Permission · UserFile · MemoryJob”.
Interface strip “Agent / Channel / ControlPlane / SandboxExecutor / MemoryStore / MemoryGenerator”.
Caption “接口定义职责；outbound adapters 实现接口”.
LAYER 4 “出站适配与 Agent Runtime · outbound”
Card1 “PiAgentGateway（项目适配器）” enclosing vertically nested framework strips:
“pi-coding-agent 0.84.3：会话 / Skills / 压缩”
“pi-agent-core 0.84.3：模型—工具执行循环”
“pi-ai 0.84.3：Provider 协议 / 模型流”
Footer “上下文：Prompt · Skills · 消息/图片/文件引用 · 用户记忆”.
Card2 “IlinkHttpClient / 存储适配器” and “fetch · node:sqlite · node:fs”.
Card3 “PDF 协议扩展（项目实现）” and “CodexFileInput · onPayload” and “远端 ID 持久化 · 短期 URL 缓存”.
A short arrow from pi-ai points to external badge “模型 Provider · 默认 Codex”. Caption “控制面模型网络”.
Only a few vertical dependency arrows connect successive layers in margins. Do not draw reply flows or crossed arrows.

RIGHT TOP panel “权限与工具执行边界”
Show “聊天 Agent 的普通工具调用” → “PermissionService” → “PolicyCompiler” → boundary box “LocalSandboxExecutor / 子进程”.
Next to PermissionService, compact readable bullets:
“真实用户确认”
“用户 + 执行器 + 工作区 + Session”
“一次 / 会话 / 长期授权”
“执行前校验 · 撤销取消”.
Inside child-process boundary show:
“supervisor → tool-worker”
“@anthropic-ai/sandbox-runtime 0.0.75”
“macOS：Seatbelt / sandbox-exec”
“Linux：bubblewrap + 网络代理”
“目录读写 / 域名白名单 / 进程取消”.
Caption below “受限执行失败即拒绝；Full Access 显式绕过沙箱，使用当前 OS 用户权限”.
Caption “沙箱约束工具子进程；微信与模型请求在主服务控制面”.
Keep readable, no long arrows crossing other panels.

RIGHT BOTTOM panel “用户记忆 · 双层 Markdown + 异步任务”
Two clearly separated blocks:
“后台写入”
“MemoryWorkerLoop → GenerateSessionMemory”
“PiMemoryGenerator：复用 ModelRuntime / pi-ai”
“提炼明细 → 合并总览；tools = []”
“MemoryStore：原子发布 / 版本校验”
“SQLite：阶段 / lease / 重试；同用户有序”
Then “聊天读取”
“新 Session 加载 MEMORY.md”
“Agent → memory_search / memory_read”
“UserMemoryService：用户隔离 / 关键词 + 按行读取”
“No embedding” may be rendered “无 embedding”.
NO arrow from PiMemoryGenerator to search/read tools.

BOTTOM foundation full width “持久化与可观测性”
Four concise cards:
“app.db · node:sqlite” / “Inbox / Session / Turn / Outbox / Trace / 文件索引 / memory_jobs”
“permissions.db” / “授权 / 申请 / 审计”
“文件系统” / “PDF 原件 · Pi JSONL · skills/” / “memory/<用户>/MEMORY.md + sessions/日期/明细.md”
“观测” / “Pino · prom-client · 模型/工具/记忆 Trace”.
Footer “技术边界：应用调度由项目实现；单 Turn 内 Agent 循环由 Pi 驱动；安全隔离在工具执行层”.

Do not invent Express, NestJS, LangChain, Temporal, Redis, vector databases, Docker, Kubernetes or microservices. All code is current implemented architecture. Do not imply sandbox wraps the whole service. Do not conflate custom adapter with SDK. Use tasteful consistent typography, no tiny illegible text, generous spacing. Can reorganize within prescribed layers to maximize readability.
