# 架构图生成说明

依据：源码提交 fa0d091。图用于 README 概览，具体边界以正文和代码为准。
生成方式：内置 image_gen。工具没有模型选择参数，不能单独核验或锁定 image2.0 / gpt-image-2。

最终产物：[system-architecture.png](system-architecture.png)。已核对：回复唯一出口、GenerateSessionMemory 编排、Agent 调用记忆搜索、上下文显示“用户记忆”。

## 最终提示词

Edit the reference into a technically accurate Chinese architecture diagram. Preserve the beautiful white background, navy title, teal/blue/orange/purple grouped panels, flat icons and crisp typography. You MAY rearrange panels to make arrows unambiguous. Landscape high resolution, large readable labels, no tiny text. Title: “微信 × Pi Agent 系统架构”. Subtitle: “文本 / 图片 / PDF / 用户记忆”.

CRITICAL: Do not preserve ANY confusing reply loops from the reference. Use TWO SEPARATE, EXPLICIT, LEFT-TO-RIGHT pipeline rows at the top. No curved return arrows. No shortcut from SQLite or Agent directly to WeChat. No bidirectional arrows in these two rows.

Top row label “消息处理”:
微信用户 → iLink Channel → IngestMessage（身份校验） → SQLite app.db（Inbox / Session / Turn） → RunNextTurn → Pi Agent SDK → pi-ai / 模型服务
Under Pi Agent SDK, small label “PiAgentGateway”. Under model service, small label “默认 Codex”.

Second row label “回复发送（唯一出口）”:
RunNextTurn 处理结果 → SQLite Outbox → DeliverReply → iLink Channel → 微信用户
Small caption: “模型回复与应用回执都走此路径”. Repeating the Channel and User nodes in this separate row is deliberate. Draw this as five fully visible nodes with simple right-pointing arrows. No line between these rows. IngestMessage does not send replies.

Below the two rows, place three panels:

LEFT teal panel “受控工具”:
Small source label “聊天 Agent 调用”.
PermissionService → PolicyCompiler → LocalSandboxExecutor → 个人目录 / 授权网络.
Use a compact vertical chain. Under executor write “Seatbelt / bubblewrap”. Note “Full Access：显式授权的宿主机权限”. Model API traffic is not sandboxed by this tool chain.

CENTER blue panel “用户文件库”:
data/files + user_files
file_list / file_use（聊天 Agent 调用）
A simple vertical flow: 本地 PDF → Codex 上传 → 短期下载链接 → onPayload: input_file.file_url → pi-ai 请求.
Note: “远端 ID 存 SQLite；签名链接仅短期缓存”.
Note: “PDF 当前仅接入 Codex”. Do not draw a local PDF parser or embedding service. Do not draw an external connector from this panel to the memory panel.

RIGHT orange panel “会话上下文”:
Four clean cards: “System Prompt”; “Skills（简介 + 按需正文）”; “消息 / 图片 / 文件引用”; “用户记忆”.
Under 用户记忆 write “会话开始时加载 MEMORY.md”. The primary card MUST say 用户记忆, not 用户总览快照.
Note: “上传回执立即加入上下文，不触发模型”.
A small caption “供 Pi Agent 使用” is enough; do not draw long crossing arrows to the top row.

BOTTOM purple panel “用户记忆：后台写入与 Agent 读取”:
Use clearly separated WRITE and READ lanes.
WRITE lane label “后台整理”:
Session 结束 → EndSession → memory_jobs → MemoryWorkerLoop → GenerateSessionMemory.
Under Session 结束 show “/new · 闲置 1 小时 · 退出 / 恢复”.
At the right of this write lane, or as a second row within it, draw a grouped box labeled “GenerateSessionMemory 编排” containing two collaborators:
“PiMemoryGenerator：通过 pi-ai 提炼 / 合并” and “MemoryStore：校验后读写 Markdown”.
The stored artifacts are “data/memory/<用户>/” with “sessions/日期/会话明细.md” and “MEMORY.md”. Only MemoryStore is connected to the artifacts. PiMemoryGenerator does not itself perform memory_search or memory_read and must have NO arrow to these tools.
If space is limited, replace the collaborator arrows with this exact readable sentence: “GenerateSessionMemory 调用 PiMemoryGenerator 生成内容，通过 MemoryStore 写入明细与总览”.
READ lane label “聊天 Agent 按需读取”:
聊天 Agent → memory_search / memory_read → UserMemoryService → MemoryStore（当前用户目录）.
Separate short caption: “新会话：MEMORY.md → 用户记忆上下文”.
This READ lane must be visually separate from PiMemoryGenerator. Never connect the generator to the search/read tools. No arrow from memory_jobs straight to Markdown storage.
Note: “归档与任务入队同事务；后台任务可重试”.

Footer “运行与可观测性”:
数据目录单实例锁 · SIGINT / SIGTERM 收尾 · Admin Tree / Chat · 模型与工具 Trace · 记忆任务 · 健康检查 / Prometheus.

Accuracy overrides artistic fidelity: reply only through Outbox → DeliverReply → Channel → User; memory search is called by the CHAT AGENT; generation and storage are orchestrated by GenerateSessionMemory; context card named 用户记忆. Reduce decorative detail if needed, but keep these relationships and Chinese text clear. No ambiguous floating arrows or arrows crossing unrelated panels.
