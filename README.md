# WeChat Pi Agent MVP

本机单用户的微信 iLink × Pi SDK Agent。架构与边界详见 [`wechat-pi-agent-mvp.html`](./wechat-pi-agent-mvp.html)。

## 能力

- iLink QR 登录、`getupdates` 长轮询、文本与图片入站、文本 `sendmessage` 与 typing。
- `pi-coding-agent` SDK + `pi-agent-core` + `pi-ai`，运行时不启动 CLI 子进程。
- SQLite inbox/cursor/session/turn/step/outbox，单 worker FIFO、崩溃恢复和稳定 `client_id`。
- Pi JSONL 会话续接；工具通过显式白名单启用。可选高风险本机 Bash，默认关闭。
- `/healthz`、`/readyz`、`/metrics`、Turn 诊断接口。
- `DRY_RUN=true` 本地无外部依赖启动模式。

## System Prompt

微信助手的系统提示词独立维护在：

`src/prompts/wechat-assistant.md`

正式 AgentSession 通过 `DefaultResourceLoader.systemPrompt` 加载该文件。默认 extensions、prompt templates 和项目 context files 始终关闭；Skills 是否加载由 `PI_LOAD_LOCAL_SKILLS` 控制。可通过 `SYSTEM_PROMPT_PATH` 指向其他 Prompt 文件；文件缺失或为空时启动失败。

## Skills 与工具

```env
PI_LOAD_LOCAL_SKILLS=true
TOOL_SANDBOX_ROOT=./data/tool-workspace
TOOL_HTTP_ENABLED=true
# 留空表示允许任意公网 HTTPS 域名；也可填写逗号分隔白名单
TOOL_HTTP_ALLOWED_HOSTS=
# 高风险：以当前 OS 用户权限直接执行宿主机命令
TOOL_SHELL_ENABLED=false
```

- Pi 扫描 `~/.pi/agent/skills/`、`~/.agents/skills/` 以及受信任项目中的 Pi/Agent Skills。
- Skill 只提供按需加载的工作流说明；具体动作仍由 AgentSession 注册的工具执行。
- `read`、`list_files`：只能访问工具沙箱和已加载 Skill 目录。
- `sandbox_write`：只能写入工具沙箱，拒绝绝对路径、路径逃逸和符号链接。
- `http_get`：只允许 GET 公网 HTTPS 文本，限制重定向、超时和响应大小，并阻止 loopback、私网、link-local 与 metadata 地址。
- `bash`：仅在 `TOOL_SHELL_ENABLED=true` 时启用。它由 Pi 内置工具直接在 `WORKSPACE_ROOT` 执行，继承当前进程环境和 OS 用户权限，不受文件工具沙箱约束。

启用 Bash 后，本地 Skill 可以调用已安装 CLI（例如 `lark-cli`），同时也能够访问宿主机文件、网络和凭证。只应在完全信任微信发送者及所有已加载 Skill 时使用。

## 图片输入

- 支持 iLink `MessageItemType.IMAGE=2`，优先使用 `image_item.media`，缺失时回退缩略图。
- 支持 `image_item.aeskey` 和 `media.aes_key` 的 AES-128-ECB 解密格式。
- CDN 仅允许 HTTPS `*.weixin.qq.com`，单张解密后最大 15MB，每条消息最多处理 4 张。
- 支持 JPEG、PNG、GIF、WebP；文件以 SHA-256 命名并保存到 `data/inbound-media/`，权限 `0600`。
- 图片元数据写入 SQLite，Agent 调用时读取为 base64 `ImageContent`，不会把图片 base64 写入 Trace。
- 当前只支持接收并理解图片，回复仍为文本。

## 环境要求

- Node.js >= 22.19
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
- Agent：Pi 调用发生在事务外；崩溃恢复后可能重做推理和工具调用。文件写入被限制在独立沙箱，网络工具仅 GET，但仍不承诺工具调用 exactly-once。
- 出站：outbox 使用稳定 `client_id` 重试；在服务端强幂等未验证前只承诺 at-least-once。
