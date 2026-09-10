# 分层技术架构图 V2

状态：视觉草图，未通过连线校验，不用于 README。产物 layered-architecture-v2-draft.png 中 Turn / Outbox 箭头反向，执行调用线起点不正确，Admin 查询线不连续。正确拓扑为：消息处理 → 任务调度 → 回复投递；任务调度 → Agent Runtime；会话管理 → 记忆任务管理 → 用户记忆。多次局部图像编辑未能稳定保持拓扑，后续宜采用可编辑矢量图精确布线。

保留 layered-architecture.png，新增独立版本。各层采用不同浅色背景，应用层分为对话处理与生命周期后台任务，领域按对话和用户资源授权分组。

箭头表达主要业务流与能力调用，Turn / Outbox 表达持久队列交接，不表示函数直接调用。会话管理不直接投递回复；任务处理也会访问 Channel 控制 typing，图中省略辅助交互。

生成方式：内置 image_gen 编辑参考图；未指定或核验具体图像模型。

## 提示词

Edit the supplied architecture diagram into a clearer and more detailed VERSION 2. Preserve its SIX named layers, Chinese title, modules and technical scope. You may redesign spacing and card positions extensively. Use a larger landscape canvas with crisp readable typography. White page, no decorative art. Title “微信 × Pi Agent 技术架构”. Subtitle “系统分层 · 模块协作 · 主要数据流”.

CRITICAL DESIGN CHANGE: each FULL LAYER BACKGROUND must have a distinct light color, not just its left label! Layer1 light slate #EDF1F7, layer2 light mint #E1F4EE, layer3 light blue #E4F0FF, layer4 light lavender #EEE7FA, layer5 light amber #FFF1D6, layer6 light rose #F7E5E8. Cards are white/near-white with darker colored outlines. Large dark text, rich but professional colors. Numbered colored layer tabs left. Increase height of application and capability layers to fit subgroups and arrow corridors. Main service labelled “Node.js / TypeScript”; no Bootstrap.

LEGEND: solid directed arrows = “主要业务流”; dashed directed arrows = “能力调用 / 查询”. Do not use generic arrows down the left edge: replace them with meaningful card-to-card arrows. Arrowheads must visibly end at actual cards. ALL connectors follow blank gutters, never pass through text, never cross unrelated cards. Limit arrows to the explicit relationships below. Arrows aggregate logical collaboration and may not mean synchronous calls. No flow to external providers from the permission or delivery card.

LAYER1 “用户界面”: 微信（用户对话） on left; Trace Admin（管理与观测） on right.
LAYER2 “渠道与接口层”: a wide grouped card 微信渠道 with TWO smaller internal endpoints “消息接收” and “回复发送”; subtitle “协议转换 · 消息收发”. On right 管理接口（查询 · 健康检查）.
Draw separate directional connectors 微信 → 消息接收 labelled “用户消息”, and 回复发送 → 微信 labelled “文本回复”. Trace Admin ↔ 管理接口 labelled “查询 / 展示”. These connectors only span adjacent layers.

LAYER3 “应用编排层”: two internal subgroups:
A broad main subgroup “对话处理” containing a horizontal pipeline:
消息处理（校验 · 去重 · 入队） → 任务调度（领取 · 路由 · 执行协调） → 回复投递（发送 · 重试）.
Arrow from 消息处理 to 任务调度 label “Turn 队列”.
Arrow from 任务调度 to 回复投递 label “Outbox”.
The presence of these arrows represents durable queue handoff, not direct function calls.
Draw 消息接收 → 消息处理 downward.
Draw 回复投递 → 回复发送 upward using an outer corridor within the conversation group, clearly label “待发回复”. Do not connect delivery directly to 微信.
A second smaller subgroup “生命周期与后台任务” below main pipeline:
会话管理（创建 / 关联 · 结束 / 归档） → 记忆任务管理（后台整理调度） labelled “归档入队”.
Draw a dashed connector 消息处理 → 会话管理 labelled “创建 / 关联”.
Draw a dashed connector 任务调度 → 会话管理 labelled “会话控制”.
NO arrow 会话管理 → 回复投递. Session control replies are generated through task handling then Outbox.
Avoid visually stacking all cards on one row. The two subgroups must be clear.

LAYER4 “核心能力层”: use a structured arrangement, not four flat equal cards.
A central-left prominent “Agent Runtime” box with three small internal stacked feature strips “上下文 / Skills / 压缩”, “模型与工具循环”, “Pi SDK”.
To its right or below, a group “用户资源能力” containing 用户记忆（总览加载 · 历史检索 / 明细提炼 · 总览合并） and 用户文件（保存 · 查询 · 选用 / 模型附件）.
At far right “权限与工具管理”（授权确认 · 权限校验 / 策略编译 · 受控执行）.
Draw 任务调度 → Agent Runtime dashed labelled “执行 / 返回结果” (a bidirectional dashed connector is acceptable).
Draw 记忆任务管理 → 用户记忆 dashed labelled “整理任务”.
A short dashed bus from Agent Runtime forks to user resources group and permissions card, labelled “按需调用”. Do NOT add detailed memory read/write loops, do NOT add class names.

LAYER5 “领域层 · 核心模型与规则”: SIX small domain cards in TWO logical groups:
“对话领域” grouping 会话（归属 · 生命周期）, 执行（任务 · 执行记录）, 投递（回复 · 投递规则）.
“用户资源与授权领域” grouping 记忆（明细 · 总览）, 文件（用户文件 · 文件引用）, 权限（主体 · 授权规则）.
No individual arrows from every application card; too cluttered. This layer shows conceptual ownership, not a request pipeline. Small caption “模型与规则供上层使用”.

LAYER6 “基础设施层”: 数据库（SQLite · 业务状态 / 索引 / 任务队列）, 文件系统（用户文件 · 会话历史 · 记忆）, 日志与观测（Trace · 日志 · 指标）.
A clean rightmost dashed corridor from 管理接口 down to 日志与观测 labelled “状态 / Trace 查询”; avoid sandbox area. If routing is difficult omit this one arrow rather than cross text.
Small caption “应用与能力通过存储接口访问基础设施”. No arrows requiring traffic to travel through each domain model.

RIGHT SIDEBAR outside service:
“外部模型服务” / “默认 Codex”, at height of core layer. Connect a dashed service-boundary arrow labelled “模型调用（Pi SDK）”. The line must not originate at permissions module; route from Agent Runtime through a gutter if possible, otherwise connect from core-layer GROUP BORDER with explicit label “模型调用（Pi SDK）”.
A separate dashed box below “工具执行子进程 / OS 沙箱”, “macOS · Seatbelt”, “Linux · bubblewrap”, “文件访问 · 网络限制”, caption “本机执行边界”. Connect 权限与工具管理 → this box labelled “受控执行”.
Sidebar is distinct from main layers, runtime and memory are INTERNAL.

Footer “主业务流示意；typing 等辅助交互省略”. Do not imply only two modules ever call Channel. Do not invent protocols, components, frameworks, or features. Keep all arrow labels short and clear. Aim readable organized architecture, not a dense sequence diagram. No floating arrows. Preserve original as an existing separate asset; produce this as a new variant.
