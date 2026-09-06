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

`http://127.0.0.1:9465/admin`

Trace Tab 展示最近 100 个真实 Agent Turn，包括：实际 Pi System Prompt 快照、用户 Prompt、Provider/模型、Skills、启用工具、Agent/Tool 事件和最终回复。完整 Prompt 存在 SQLite `agent_traces` 表中；`TRACE_RETENTION=100` 控制保留数量。页面只监听配置的 Admin 地址，默认是 localhost。

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /debug/traces?limit=100`
- `GET /debug/traces/:turnId`
- `GET /debug/turns/:turnId`
- `GET /debug/recent-errors?limit=20`

## 交付语义

- 入站：inbox 去重与 cursor 推进在同一个 SQLite 事务中。
- Agent：Pi 调用发生在事务外；崩溃恢复后可能重做推理和工具调用。工具使用每次调用的有效权限，Full Access 允许宿主机操作；不承诺工具调用 exactly-once。单次权限采用尝试前原子消费，失败不会自动恢复额度。
- 出站：outbox 使用稳定 `client_id` 重试；在服务端强幂等未验证前只承诺 at-least-once。
