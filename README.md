# WeChat Pi Agent MVP

本机单用户的微信 iLink × Pi SDK Agent。架构与边界详见 [`wechat-pi-agent-mvp.html`](./wechat-pi-agent-mvp.html)。

## 能力

- iLink QR 登录、`getupdates` 长轮询、文本与图片入站、文本 `sendmessage` 与 typing。
- `pi-coding-agent` SDK + `pi-agent-core` + `pi-ai`，运行时不启动 CLI 子进程。
- SQLite inbox/cursor/session/turn/step/outbox，单 worker FIFO、崩溃恢复和稳定 `client_id`。
- Pi JSONL 会话续接；用户权限持久化、对话授权、系统沙箱内工具执行和显式宿主机 Full Access。
- `/healthz`、`/readyz`、`/metrics`、Turn 诊断接口。
- `DRY_RUN=true` 本地无外部依赖启动模式。

## System Prompt

微信助手的系统提示词独立维护在：

`src/prompts/wechat-assistant.md`

正式 AgentSession 通过 `DefaultResourceLoader.systemPrompt` 加载该文件。默认 extensions、prompt templates 和项目 context files 始终关闭；Skills 是否加载由 `PI_LOAD_LOCAL_SKILLS` 控制。可通过 `SYSTEM_PROMPT_PATH` 指向其他 Prompt 文件；文件缺失或为空时启动失败。

## 工程 Skills 与加载记录

随工程发布的能力放在 `WORKSPACE_ROOT/skills/<name>/SKILL.md`，例如：

```text
skills/
└── summarize/
    ├── SKILL.md
    ├── references/
    └── scripts/
```

`SKILL.md` 使用 YAML 文件头，例如 `name: summarize`、`description: 总结用户提供的长文本`；简介必须非空。目录目前只提供存放约定，没有预装业务 Skill。部署时须连同 `skills/` 一起发布，并将 `WORKSPACE_ROOT` 指向工程根目录；单独复制 `dist/` 不包含 Skills。

`PI_LOAD_LOCAL_SKILLS=true` 开启全部 Skill 来源（默认 false，false 也会关闭工程内置目录）。启动时扫描一次，所有用户共享生效目录；新增、删除或修改名称/简介后重启服务。正文在实际加载时读取，已有 Session 中的旧正文不会自动替换。

复用 Pi 的解析和同名去重，以解析后的 `name` 决定整份 Skill 的生效版本，优先级从高到低：

1. 项目 settings 显式配置的本地 Skill 路径。
2. 工程 `skills/`。
3. 项目自动发现目录：`.pi/skills/`、`.agents/skills/`（按 Pi 原有顺序及项目信任规则）。
4. 用户 settings 显式配置的本地路径。
5. 用户自动发现目录：`~/.pi/agent/skills/`、`~/.agents/skills/`。
6. Pi 资源包提供的 Skill。

Agent 目录可用 `PI_CODING_AGENT_DIR` 覆盖。工程不会默认扫描 `~/.codex/skills/`。同名只保留高优先级版本，不合并正文；其余来源之间仍按 Pi 原有顺序处理。启动日志 `skill_loaded` 记录生效名称、路径和来源，`skill_shadowed` 记录同名冲突的 winner/loser 路径，其他解析问题记录为 `skill_diagnostic`。

两种调用方式：

- **自然语言**：“帮我总结这份文档”。模型根据系统提示词中的 Skill 目录选择，再用 `read` 按需读取正文。
- **显式指定**：`/skill:summarize 帮我总结这份文档`。程序校验名称并展开正文，再交给模型。名称不存在或文件不可读时直接回复明确错误，不调用模型猜测。Pi 的 `disable-model-invocation: true` 会隐藏自动选择目录中的该 Skill，但仍允许显式指定。

每轮 Trace 中统一记录 `skill_load`：`mode=explicit/model`、`status=loaded/failed`、名称、路径和来源；模型读取附带 `toolCallId`，失败附带原因。显式加载在正文展开后记录；模型加载在 `read` 完成后记录，仅识别最终生效的 Skill 入口路径（相对路径按个人工作目录解析）。读取参考资料、脚本或使用历史上下文不会新增 Skill 加载事件。它表示加载结果，不代表模型严格遵循或执行完成。显式校验失败会正常回复用户，本轮可完成，但对应加载事件标为失败。

Skill 指引不授予执行权限；受限模式下已加载 Skill 目录可读且受写保护，后续脚本、网络及写入仍受权限系统控制。

## PDF 文件与用户文件库

支持从微信接收 PDF：仅发送文件时回复保存结果；随后可以说“查询我的简历”“分析 resume.pdf”。文件归属于用户，跨 Session 保留；`/new` 不删除文件，也不影响新会话查询自己的文件。多份候选文件应由用户确认选择。

- 原件：`DATA_DIR/files/<subjectKey>/<fileId>/original.pdf`；目录 0700、文件 0600。文件名只用于展示，原件路径由系统生成。
- 索引：主 SQLite 的 `user_files` 表。`model_file_refs` 保存与 Codex 认证账号隔离的远端文件 ID，签名下载 URL 只作短期内存缓存。
- 首版限制：单 PDF 最多 20 MiB，每条消息最多保存 3 份，每轮最多选择 3 份，单用户已保存原件最多 500 MiB。超限或失败明确回复；不自动删除旧文件。清理接口尚未提供，存储清理由管理员处理。
- 首版直接文件分析接入 `openai-codex-responses` 的官方 ChatGPT 后端。其他通道的文字/图片行为保持原样，调用文件工具时会提示文件输入尚未接入，无需用户维护 provider 能力配置。

Agent 工具：`file_list({query?, offset?})` 跨会话查询当前用户文件，`file_use({fileId})` 选择文件。选择后由模型接入层上传/复用原件，在 Pi 的 `onPayload` 中附加 `input_file.file_url`；模型调用、认证接入和流式回复仍由 Pi 完成。系统不本地解析 PDF，不另配 OpenAI API Key，也不修改 Pi 依赖源码。

原件只在需要分析时上传。远端链接有效时复用；链接缓存失效后用远端 ID 获取链接，远端文件不存在时自动重传本地原件。上传/刷新出错保留本地文件；上传超时可能留下远端孤立文件，删除/长期保留策略尚未接入。

纯文件上传保存成功后，立即通过 `Agent.recordContext()` 把上传元信息和应用回执加入当前会话，不触发模型推理。`context_update` 会记录追加内容和更新后的上下文快照。业务数据库是持久事实源；Pi 在首个 Assistant 消息前可能尚未刷出 JSONL，因此重启或压缩后仍会在下一次模型调用前按 Session/Turn 顺序补入缺失的最近 20 条记录（`context_replay`），并按事件 ID 去重。图片继续通过 Pi 的图片消息进入历史。

文件选择仅在当前 Turn 有效，历史只保存 ID 和元信息；同一 Turn 后续模型轮次会重复附加已选文件链接。后续 Turn 或压缩后需要原文时，Agent 再次 `file_use`，不会自动把全部历史附件加入每次请求。当前选中原件的大小/哈希在使用前会重新校验。

下载在 SenderPolicy 过滤和消息落库之后、Turn 执行时进行。文件 CDN 引用只持久化在受保护的 inbox 字段；raw 消息、Admin 文件详情和文件事件不返回密钥/签名 URL。文件库属于控制面保护目录，通用 read/bash 不因新增文件能力而获得访问权限。

Trace 会展示无模型调用的文件接收 Turn，以及 `file_save`、`file_selected`、`file_upload`、`file_input`、`file_error` 的 span。保存、上传、附加和模型完成分别表示不同阶段。现有 Turn 崩溃恢复限制仍适用，不承诺中断任务自动精确续传。

验证：`npm run check` 执行离线回归。可选 `npm run build` 后执行 `node scripts/verify-file-input.mjs --live`，会通过当前 Codex 登录上传一份无敏感内容的合成 PDF，运行两个独立 Session 检查跨会话读取和历史中无签名 URL；这会消耗模型用量，并创建远端测试文件。具体结果见 `docs/designs/pdf-attachments/gateway-verification.json`。真实微信 PDF 收发仍须单独验收。

## 用户记忆与会话结束

记忆位于 `DATA_DIR/memory/<用户标识>/MEMORY.md` 和 `sessions/日期/<sessionId>.md`。`/new`、闲置 1 小时、正常退出和启动恢复都走统一结束入口；归档与记忆任务入队原子完成。后台提炼会话明细、按用户串行更新总览，失败可重试，不阻塞新聊天。

新 Session 固定加载当时的总览，后续后台更新不改变当前快照；恢复和压缩仍使用该版本。Agent 可通过 `memory_search` 字面关键词搜索，再用 `memory_read` 读取明细，不使用 embedding。Admin 页的“记忆任务”可以查看后台模型调用及生成内容。

正常退出会先停接收和领取，等待最多 30 秒后取消未完成工作，归档并入队；未执行的记忆任务下次启动继续。硬崩溃不执行 finally，启动时在数据目录单实例锁保护下归档旧 Session，中断任务不会自动重新执行工具。已生成的回复仍可由 Outbox 恢复发送。

具体目录、限制、重试与恢复语义见 [用户记忆说明](docs/user-memory.md)。

## 用户权限与系统沙箱

默认每个用户仅能读写个人工作目录、读取已批准的 Skill 目录。Bash 与工具网络默认关闭。模型调用和微信收发属于控制面，不受工具网络开关影响。

```env
PI_LOAD_LOCAL_SKILLS=true
TOOL_SANDBOX_ROOT=./data/tool-workspace
# 空值时首次启动生成，之后复用 data/executor-id
PERMISSION_EXECUTOR_ID=
```

权限绑定 `channel + bot/accountId + senderId + executorId + workspaceId`；个人目录位于 `TOOL_SANDBOX_ROOT/<subject hash>`。当前入站仍只允许配置的单一微信发送者，该身份是本机所有者。不同 bot/发送者/执行环境/工作区不会自动复用授权。旧 `TOOL_SHELL_ENABLED`、`TOOL_HTTP_ENABLED`、`TOOL_HTTP_ALLOWED_HOSTS` 已不再授予权限，即使旧 `.env` 中为 true，也从基本权限开始。

通过微信直接说：

- “查看权限”或 `/permissions`。
- “开启全部权限”：生成待确认申请，随后回复系统给出的 `确认授权 <编号>`。
- “允许你读取 ~/Downloads，以后都可以”：AI 调用 `permissions_request` 生成目录申请；按返回消息确认。
- “只允许这一次访问 example.com”：AI 可以申请 `once`；也支持 `session` 和 `persistent`。
- “恢复基本权限”或 `/permissions reset`：撤销所有授权及待确认申请。
- `/permissions revoke <编号>`：撤销指定授权；`/permissions reject <编号>` 拒绝待确认申请。

还支持完全绕过模型的申请入口：`/permissions request shell`、`/permissions request read /绝对目录`、`/permissions request write /绝对目录`、`/permissions request network example.com`、`/permissions request full-access`。这些入口申请长期权限，仍需确认。网络域名采用精确匹配，子域名需显式 `*.example.com`；`*` 表示允许所有域名。网络授权不等同于 HTTP 方法或内容授权，Bash 中的程序也受同一出口规则约束。受限模式始终禁止连接本服务管理端口；其余已授权域名可能指向私网资源，若要保持公网范围，应只批准可信的公网域名。

申请不会立即开启权限。确认必须来自已鉴别身份的真实入站消息，绑定用户、对话、会话、请求编号与权限版本，10 分钟内有效。重复消息返回原回执，不会重新授权；权限发生变化后，旧待确认申请需重新创建。长期授权跨重启和 `/new` 保留；会话授权在 `/new` 时撤销；单次授权限批准后 10 分钟内的一次匹配工具尝试（失败也消耗），Bash 会消费该次命令可以使用的单次授权。

**授权后自动继续任务**：AI 在任务中提出的权限申请会关联当前 Turn。用户确认成功后，系统发送授权回执，并自动将原任务的续跑加入队列，沿用原会话、任务文本和图片，无需用户再输入“继续”。回执与续跑入队在同一 SQLite 事务中提交，每个申请编号最多创建一条续跑；重复确认不会再次创建。重启后继续处理已保存的队列，执行前重新检查授权和会话状态。授权已撤销、过期、单次权限已消费或原会话已结束时，取消续跑。单独的 `/permissions request ...` 设置命令和升级前未关联任务的旧申请只变更权限，不猜测要继续哪一个任务。

续跑会结合已有会话和工具结果继续工作，不是自动重放失败的 shell 命令。一次入队不等于外部副作用 exactly-once：运行中崩溃仍遵循现有任务恢复语义，模型需核对已完成的操作。

### 执行机制

所有 `read`、`list_files`、`sandbox_write`、`http_get`、`bash` 均通过 `LocalSandboxExecutor`，不再调用 Pi 内置的原生 Bash。受限模式使用固定版本的 `@anthropic-ai/sandbox-runtime`（macOS Seatbelt / Linux bubblewrap），沙箱初始化失败会拒绝执行，不降级为宿主机命令。每次调用独立 supervisor 和网络代理，避免库的全局配置在用户间串用。

策略来自结构化授权记录，经 `PolicyCompiler` 转换成运行库配置，Seatbelt profile 是生成产物，不是另一份可独立修改的授权源。受限模式清理继承环境；授权数据库、凭据、会话与服务代码的写入受到保护。读取系统运行库是工具正常启动的基础能力，不意味着整个磁盘只可见一个文件夹。受限目录授权不能覆盖其他用户工作区或其祖先，须选择更具体的目录；运行库和应用代码不可写，安装或更新宿主机工具需要 Full Access。

**宿主机 Full Access** 明确绕过工具沙箱，拥有当前 OS 用户的文件、网络和命令执行权限，不自动取得 root。此模式可修改服务本身、凭据和授权数据库，因此不能承诺其他用户隔离或防篡改审计；本实现只允许当前配置的机器所有者申请它。撤销会停止受管理的执行进程组和当前模型轮次，后续工具使用新策略，但不会回滚已发生的宿主机改动，也无法约束 Full Access 程序主动脱离进程组后留下的任务。

工具输出和超时有上限：文本读取/写入约 500 KB，Bash 默认 60 秒、最多 120 秒。`http_get` 使用 HTTPS GET，不跟随重定向。沙箱不提供 CPU/内存配额或文件回滚。

### 存储与代码入口

接口集中在 `src/application/interfaces/`，按职责命名：`Agent`、`Channel`、`ControlPlane`、`Telemetry`、`PermissionRepository` 和 `SandboxExecutor`。权限持久化由 `SqlitePermissionRepository` 实现，沙箱执行由 `LocalSandboxExecutor` 实现。

- `data/permissions.db`：授权请求（含已批准 grants）、当前长期策略快照、消息回执、权限变更事件；数据库文件权限 0600。
- `data/executor-id`：本执行环境的稳定 ID。部署到另一台机器时使用不同 ID，不要原样复用权限数据和执行器身份。
- `src/application/services/permission-service.ts`：申请、确认、撤销、单次消费与用户身份绑定。
- `src/application/services/policy-compiler.ts`：个人工作目录和执行策略编译。
- `src/adapters/outbound/sandbox/`：可信 supervisor 与受限 worker。
- `src/adapters/outbound/pi/tools/index.ts`：Pi 工具统一入口；模型只具有查看和申请权限工具。

## 图片输入

- 支持 iLink `MessageItemType.IMAGE=2`，优先使用 `image_item.media`，缺失时回退缩略图。
- 支持 `image_item.aeskey` 和 `media.aes_key` 的 AES-128-ECB 解密格式。
- CDN 仅允许 HTTPS `*.weixin.qq.com`，单张解密后最大 15MB，每条消息最多处理 4 张。
- 支持 JPEG、PNG、GIF、WebP；文件以 SHA-256 命名并保存到 `data/inbound-media/`，权限 `0600`。
- 图片元数据写入 SQLite，Agent 调用时读取为 base64 `ImageContent`，不会把图片 base64 写入 Trace。
- 当前只支持接收并理解图片，回复仍为文本。

## 环境要求

- Node.js >= 22.19
- 受限工具执行：macOS 的 `sandbox-exec`；Linux 需安装 bubblewrap、socat、ripgrep。其他平台受限执行失败关闭；真实沙箱测试目前覆盖 macOS。
- ChatGPT Plus/Pro Codex OAuth（正式模式）
- 已获得可用的 iLink/ClawBot 账号能力（正式模式）

## 安装与验证

```bash
npm install
npm run check
```

## Dry-run 启动

```bash
cp .env.example .env
# .env.example 已默认 DRY_RUN=true
npm run dev

curl http://127.0.0.1:9464/healthz
curl http://127.0.0.1:9464/readyz
curl http://127.0.0.1:9464/metrics
```

Dry-run 不访问微信或模型，仅用于检查进程、SQLite、worker 和管理接口。

## 正式启动与首次引导

`.env` 中只需先切换运行模式：

```env
DRY_RUN=false
```

然后直接启动：

```bash
npm run dev
```

首次启动会自动完成缺失项，不需要预先运行 Pi CLI：

1. 未检测到 iLink 凭证：显示微信二维码并等待扫码确认。
2. 未检测到 Codex OAuth：通过 `pi-ai` / `ModelRuntime.login()` 自动打开浏览器登录。
3. 未绑定模型：读取当前 Provider 的可用模型并在终端显示选择列表。
4. 完成后继续启动 worker 和管理接口。

持久化位置：

- iLink 凭证：`data/credentials/ilink.json`，权限 `0600`。
- Pi OAuth：`~/.pi/agent/auth.json`。
- 模型选择：`data/settings.json`；也可以用 `PI_MODEL_ID` 显式覆盖。

需要单独重新扫码时仍可执行：

```bash
npm run ilink:login
```

## Admin Trace 页面与运维接口

启动后打开：

`http://127.0.0.1:<ADMIN_PORT>/admin`（当前本地配置 9465；代码及 `.env.example` 默认 9464）

管理页采用 Session 导航、调用树（Tree / Chat）和详情面板三栏布局，展示最近 100 个 Turn，包含不调用模型的应用回执。支持消息/文件/ID 搜索、日期筛选、模型与工具节点选择，以及实际请求 JSON 和原始事件查看。

每个模型轮次独立记录 `model_start`、`model_request`、`model_http_response`（HTTP 回调可用时）、`model_end`，包含协议转换前的 Agent 上下文、文件注入后实际发送的 Provider 请求、接口返回的 Assistant 内容（文本、公开 reasoning、工具调用）、Token 用量和错误。调用树用真实 modelCallId 与返回的 toolCallId 关联父子节点，不按工具名称猜测。模型没有返回可见 reasoning 时明确标记；旧 Trace 没有采集的模型内容不会重建。

工具输入输出不再统一截成 8 KiB。快照保留普通文本，认证字段、签名 URL、图片/文件二进制和不透明推理签名被脱敏或替换为元信息；单字符串上限 100 万字符、单快照文本预算 200 万字符，超限会明确标记 `truncated`。可在模型节点的“运行”页按角色查看实际上下文，在“请求 JSON”页核对发送结构，在工具节点查看参数和结果。

应用直接处理的文件上传有独立 `context_update` 节点，可以查看上传结束时已加入的上下文，并与后续模型输入核对。模型输出在该次模型调用完成时保存；流式进行中的调用显示运行中，不将缺失输出当作空回复。

系统 Prompt 快照存在 SQLite `agent_traces` 表，`TRACE_RETENTION=100` 控制这类快照的保留数量。模型/工具/上下文事件存储在 `steps`，当前没有按此开关自动清理事件正文。页面只监听配置的 Admin 地址，默认 localhost。

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /debug/traces?limit=100`
- `GET /debug/traces/:turnId`
- `GET /debug/turns/:turnId`
- `GET /debug/recent-errors?limit=20`

## 交付语义

- 入站：inbox 去重与 cursor 推进在同一个 SQLite 事务中。
- Agent：Pi 调用发生在事务外；启动恢复会结束旧会话并取消其未完成 Turn，不自动重做工具调用；已完成的副作用不会回滚。工具使用每次调用的有效权限，Full Access 允许宿主机操作；不承诺工具调用 exactly-once。单次权限采用尝试前原子消费，失败不会自动恢复额度。
- 出站：outbox 使用稳定 `client_id` 重试；在服务端强幂等未验证前只承诺 at-least-once。
