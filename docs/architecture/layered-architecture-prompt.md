# 分层技术架构图

按用户确认的六层职责视图绘制：用户界面、渠道与接口、应用编排、核心能力、领域、基础设施。仅表达模块职责与边界，不表示逐函数调用或代码目录已重构。内置 image_gen 生成，工具未提供具体模型选择参数。

## 提示词

Create a polished Chinese TECHNICAL ARCHITECTURE DIAGRAM. Use case infographic-diagram. Wide landscape 3:2 canvas, sharp large legible Chinese typography, white background, restrained navy, teal, blue, purple, amber. Professional enterprise architecture diagram with aligned rectangles, consistent grid, generous whitespace. No decorative illustrations. Title “微信 × Pi Agent 技术架构”. Subtitle “系统分层 · 模块职责 · 执行边界”.

The MAIN composition is SIX stacked horizontal layers occupying 80% width, with a narrow RIGHT side area for external model service and sandbox execution boundary. Each layer has a colored left label and neatly aligned module cards. Main service rectangle encloses layers 2 through 5 ONLY and is labelled “主服务 · Node.js / TypeScript”. Layer 1 UI is above that service boundary; layer 6 infrastructure below. Layers communicate via small downward arrows on the far left between layers; legend “层间箭头表示主要关系”. These are conceptual architecture relationships, not exact function call sequences.

LAYER 1 label “用户界面”.
Two equal cards: “微信” / “用户对话”; “Trace Admin” / “管理与观测”.
LAYER 2 label “渠道与接口层”.
Two cards aligned with UI: “微信渠道” / “消息收发 · 协议转换”; “管理接口” / “管理查询 · 健康检查”.
LAYER 3 label “应用编排层”.
Five equal cards:
“消息处理” / “接入校验 · 持久化入队”
“任务调度” / “任务领取 · 执行协调”
“回复投递” / “消息投递 · 失败重试”
“会话管理” / “会话生命周期”
“记忆任务管理” / “后台整理调度”
No class names, no internal queues, no statuses.
LAYER 4 label “核心能力层”. Make this row taller than other rows.
Four equal large cards:
“Agent Runtime” with lines “上下文与 Skills”, “模型与工具循环”, small technology badge “Pi SDK”.
“用户记忆” with lines “总览加载 · 历史检索”, “明细提炼 · 总览合并”.
“用户文件” with lines “文件保存 · 查询与选用”, “模型附件适配”.
“权限与工具管理” with lines “授权确认 · 权限校验”, “执行策略 · 受控工具”.
LAYER 5 label “领域层”.
Six equal cards:
“会话” / “归属 · 生命周期”
“执行” / “任务 · 执行记录”
“投递” / “回复 · 投递规则”
“记忆” / “明细 · 总览”
“文件” / “用户文件 · 文件引用”
“权限” / “主体 · 授权规则”
Small subtitle near layer label may say “核心模型与规则”. No class names or implementation files.
LAYER 6 label “基础设施层”.
Three equal cards:
“数据库” / “SQLite · 业务状态与索引”
“文件系统” / “用户文件 · 会话历史 · 记忆”
“日志与观测” / “Trace · 日志 · 指标”
This is shared local infrastructure, not three separate servers. No fake icons implying cloud.

RIGHT AREA:
A clearly separated box near upper middle “外部模型服务” with subtext “默认 Codex”.
A single thin arrow from right edge of the MAIN SERVICE boundary at level of core layer to this box labelled “模型调用”. No line running across module cards. Use boundary connection; not specifically anchored at permissions card.
Below that, an independent dashed box labelled “工具执行子进程”, subheading “OS 沙箱”, inside “macOS · Seatbelt” and “Linux · bubblewrap”, and “文件访问 · 网络限制”.
One short arrow from “权限与工具管理” card's right edge to this box labelled “受控执行”.
Sandbox is outside main service process but is a LOCAL system component, not an external hosted service. Add small caption “本机执行边界”.
Do not draw Agent Runtime or memory outside main service. No Bootstrap, no inbound/outbound labels, no detailed workflow, no memory read/write arrows, no class names, no DB table names, no function call chains. Keep simple: clear layers, full functional scope, module ownership, no long crossing arrows. Text accuracy and structural readability are highest priority. Do not add technologies not requested.
Footer short legend “分层展示职责；同层模块可协作”.
