# WeChat × Pi Agent 当前系统架构

基于 2026-09-09 本地源码绘制，表示已实现的结构，不代表真实账号或线上运行验收。

![系统架构](current-system-2026-09-09.png)

## 关键关系

- 单实例 Node.js / TypeScript 服务；Bootstrap 组装依赖，启动收消息、执行 Turn、投递 Outbox、记忆处理和闲置扫描五个循环。
- 消息经 iLink、发送者校验和去重后进入 SQLite；Turn worker 处理命令、附件和 Agent 请求，完成结果写入 Outbox，再异步投递微信文本。
- PiAgentGateway 封装 Pi SDK；模型和工具循环在进程内运行。模型选择按可信 subjectKey 保存，Agent 请求绑定 TurnBinding；ProviderRequestGate 协调模型调用与认证操作。
- 模型管理命令与 Admin 管理入口受 MODEL_MANAGEMENT_ENABLED 控制。其他 Provider 的可用性依赖配置与认证。
- 普通工具经 PermissionService、PolicyCompiler 和 LocalSandboxExecutor 执行；受限子进程使用 macOS Seatbelt 或 Linux bubblewrap。微信收发和模型请求属于主进程控制面。显式 Full Access 使用当前 OS 用户权限。
- PDF 原件按用户保存，经 file_list / file_use 选择后接入 Codex 文件输入；图片经 Pi ImageContent 输入。纯文件上传记录上下文回执而不调用模型。
- Session 结束后创建后台记忆任务，PiMemoryGenerator 独立提炼与合并 Markdown；新 Session 加载总览快照，专用工具搜索和读取明细。
- SQLite 保存业务状态、队列与索引；独立权限数据库保存授权与审计；文件系统保存会话历史、附件、记忆与认证配置。

## 源码依据

- `src/bootstrap/container.ts`：组件组装、五个循环、模型管理开关、启动恢复。
- `src/application/use-cases/run-next-turn.ts`：命令、授权续跑、文件回执、Agent 调用与 Outbox。
- `src/adapters/outbound/pi/pi-agent-gateway.ts`：模型绑定、请求 gate、Pi SDK 和文件输入。
- `README.md`：当前能力与存储布局，结合上述代码核实。

## 图像生成

使用内置 imagegen 生成；完整提示词保存在同目录的 `current-system-2026-09-09.prompt.txt`。
