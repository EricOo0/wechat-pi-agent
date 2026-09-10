---
{
  "id": "R-001",
  "title": "系统模块化与工作流重构",
  "kind": "feature",
  "maturity": "stable",
  "status": "implemented",
  "lifecycle": "planned",
  "affects": [],
  "changes": [
    "F-002",
    "H-001"
  ],
  "effective": null
}
---

> 实现核对：[版本化核对记录](reviews/README.md)

# R-001：系统模块化与工作流重构规格

本文是 R-001 的唯一规格正文，合并目标、结构设计、边界和验收要求；不另维护重复的 design.md。已确认按本规格的架构方向整理，本地代码重构与自动化验证已完成，已提交并推送 e3e934f；真实运行验收仍待完成。当前覆盖现有 WeChat × Pi Agent；Harness 在重构完成后另行扩展。当前流程范围见第 12 节已确认决策。

[开发状态](../../changelog/planned.md) · [功能覆盖表](coverage.md) · [逐文件迁移归属](source-map.md) · [图像提示词](../../architecture/proposals/system-refactor/assets/architecture.prompt.txt)

> 当前范围：模块化重构与现有行为兼容；不引入 Graph、checkpoint 或通用进程恢复。

[当前架构与调用关系](../../architecture/current/2026-09-10/README.md)。原带 Graph 的图片仅作为历史讨论材料保留。

## 1. 问题、目标与范围

当前 RunNextTurn 混合领取、命令、附件、Agent 调用和投递编排，ControlPlane 集中跨模块存储操作，Pi 工具定义和能力实现也有交织。重构目标是让每项行为和关键状态拥有明确的模块归属，以公开接口组合，并使多步骤流程及恢复边界可以检查。

验收以现有功能保持、依赖边界清晰、流程可解释和数据兼容为准，不能只以文件移动完成为准。

具体约束：

- 采用领域模块化目录；模块内部按 application、domain、ports 分层，跨模块通过 index.ts 暴露的接口访问。不再集中组织全局 use-cases。
- 应用流程使用模块内的普通函数或应用服务编排；生命周期用明确状态与合法转换约束，不引入 Graph 执行引擎。
- Agent Runtime 协调单次 Pi 运行与取消；应用服务负责业务流程，不新增通用 Workflow Runtime。
- 适配层只实现外部协议、SDK 和数据映射。发送内容、重试策略、入库去重、权限决策等业务逻辑由所属模块负责。
- 单进程 Node.js、SQLite、JSONL、Markdown、本地沙箱继续作为实现基础。任务并发首先保持当前单 Turn worker 行为。
- 不引入 Goal、Goal Controller、里程碑、预算驱动自动推进、通用 Verification、多 Agent、远端执行环境或新增渠道。

## 2. 五层职责和依赖

| 层 | 内容 | 依赖规则 |
|---|---|---|
| 接入与展示 | 微信命令解析、回复呈现、Admin HTTP 页面与路由、登录及运维入口 | 调用模块公开应用接口；不直接读数据库或操作 Pi |
| 应用 | Messaging、Conversation、Turns，以及各能力应用服务；Agent Runtime | 编排流程，调用领域规则及输出端口 |
| 领域与能力 | 状态、规则、策略：会话、任务、投递、上下文、记忆、权限、工具、Skills、文件、模型、执行、观测 | domain 不依赖 Pi、HTTP、SQLite；复杂流程位于模块 application |
| 协议适配 | iLink、Pi、模型认证、Codex 文件、SQLite、文件系统、沙箱、遥测 | 向内实现端口，向外调用具体依赖；不自行推进业务状态 |
| 基础设施与外部依赖 | Pi SDK、模型服务、iLink/CDN、数据库、文件系统、OS 进程和沙箱 | 实际资源；不强制再建立一层转发代码 |

Bootstrap 是组装根，允许依赖具体适配器；模块不反向依赖 Bootstrap。Workers 负责循环、领取、唤醒和退出，不放业务分支。模块核心依赖接口，协议适配器依赖并实现这些接口。

## 3. 模块和唯一状态归属

| 模块 | 拥有的状态与职责 | 对外协作 |
|---|---|---|
| messaging | Inbox、渠道 cursor、消息去重、渠道到会话映射、Outbox、投递重试 | conversation 取得会话，turns 接受任务；调用渠道收发端口 |
| conversation | 应用 Session、生命周期、输入排序约束、上下文事件来源、Pi 历史关联 | turns 管执行；context 管模型输入；memory 管归档后的整理 |
| turns | 当前 Turn 排队、领取、执行与终态、授权 continuation 的幂等关联 | 调用 Agent Runtime；完成后通过原子提交生成投递意图 |
| context | 系统提示词与输入组装、回执去重重放、记忆快照引用、压缩后的重建规则 | 读取 conversation、memory、skills、artifacts 公开接口 |
| memory | 用户总览与会话明细、检索、提炼/合并任务、版本发布规则 | 调用生成端口；独立 worker，不执行聊天工具 |
| permissions | 可信主体、授权范围/期限/消费、申请、确认、撤销与审计 | tools 实时校验；撤销通知 Runtime 和 execution；turns 管续跑 |
| tools | 统一工具契约、注册、参数和调用结果、调用分派 | 调用权限、执行、文件和记忆等能力；Pi 工具定义只做协议桥接 |
| skills | 发现来源、同名优先级、目录快照、自然语言读取与显式调用规则 | Pi 资源加载及文件读取经端口；context 使用目录，tools 支持读取 |
| artifacts | 图片/PDF 元信息、文件库、配额、归属、哈希、Turn 内选择、远端引用 | iLink 负责传输协议，Codex 负责上传/签名链接协议，context 组织引用 |
| models | 用户模型选择、Turn 固定绑定、认证操作、在途请求协调和脱敏审计 | 聊天、记忆生成、文件上传共同遵守账号切换边界 |
| execution | 执行策略编译、受管执行生命周期、撤销取消和清理 | permissions 给授权事实；Sandbox Adapter 执行 OS 操作 |
| observability | 事件格式、快照预算、脱敏、查询投影、健康状态 | Admin 查询公开接口；logger、Prometheus 适配具体输出 |

Turns 是现有轮次任务模块，不是长程 Task。Conversation 管会话生命周期和输入顺序约束；Turns 是运行所有权的唯一管理者，领取时须确保同一会话没有第二个执行所有者。Conversation 不再独立维护另一份运行锁。

Run 是 Runtime 的一次调用，不在此次重构中替换所有已有 Turn ID。数据库和旧 Trace 对外 ID 先保留，通过投影逐步分离执行状态与投递状态。长期记忆不承担未完成任务的执行状态。

## 4. 目标目录

以下是规范性目标目录，尚未创建代码骨架。每个模块按实际复杂度创建内部文件，不要求空目录占位。

```text
src/
├── bootstrap/
│   ├── main.ts                 # 进程入口、信号处理、单实例锁
│   ├── config.ts               # 配置加载和校验
│   ├── container.ts            # 唯一组装根
│   └── lifecycle.ts            # 迁移、就绪、启动恢复、退出协调
├── entrypoints/
│   ├── wechat/                 # 命令解析、文本呈现；不实现 iLink 协议
│   ├── admin-http/             # 页面、路由、访问校验
│   └── cli/                    # iLink 登录、模型 onboarding
├── modules/
│   ├── messaging/              # 接收、Inbox/cursor、Outbox、投递
│   ├── conversation/           # Session、生命周期与上下文事件来源
│   ├── turns/                  # 现有 Turn、队列、授权 continuation
│   ├── context/                # 提示词、历史、回执、压缩与重建
│   ├── memory/                 # 长期记忆与后台整理
│   ├── permissions/            # 权限规则、可信控制与审计
│   ├── tools/                  # 工具注册及调用分派
│   ├── skills/                 # Skill 来源、优先级和加载
│   ├── artifacts/              # 图片、PDF 文件库和引用
│   ├── models/                 # 模型绑定、认证与请求协调
│   ├── execution/              # 策略编译、执行控制和取消
│   └── observability/          # 事件、脱敏、查询、健康
│       # 每个模块按需采用以下内部结构：
│       # index.ts              对外接口
│       # application/          service / commands / queries / workflows
│       # domain/               模型、状态机、规则
│       # ports/                本模块定义的外部依赖接口
├── runtime/
│   └── agent/                  # 单 Run 生命周期、输入输出、事件和取消
├── adapters/
│   ├── ilink/                  # 收发、二维码、凭证、图片/PDF 传输协议
│   ├── pi/                     # SDK 会话/Loop/工具/Skill/上下文桥接
│   ├── models/                 # Provider 目录、认证、凭证桥接
│   ├── codex-files/            # PDF 上传、远端 ID、下载链接协议
│   ├── sqlite/                 # Repository、原子事务、迁移、查询投影
│   ├── filesystem/             # 文件原件、记忆正文、本地设置
│   ├── sandbox/                # Seatbelt/bubblewrap、supervisor、tool-worker
│   ├── telemetry/              # Pino、Prometheus
│   └── dry-run/                # Channel / Agent / Memory 确定性替身
├── workers/                    # 接收、Turn、投递、记忆、闲置扫描
├── prompts/                    # 聊天、记忆提炼、记忆合并提示词
└── shared/                     # clock、ID、基础结果等少量公共类型

test/
├── unit/                       # 按目标模块和 Runtime 归档
├── contract/                   # iLink/Pi/存储等边界契约
└── integration/                # 跨模块现有行为及恢复边界
skills/                         # 当前工程 Skill 内容，保持原位置
scripts/                        # 构建复制、真实验证脚本，跟随实际迁移更新
docs/                           # 当前六类文档入口保持
```

业务流程属于所属模块的 application/workflows；目录名仅表示业务编排，不表示需要工作流引擎。公开接口避免传递 Pi SDK 类型、SQL 连接或具体沙箱实例。

## 5. Workflow 与状态机

| 流程 | 建议表达 | 关键节点与边界 |
|---|---|---|
| 接收入库 | 短事务流程 | 可信发送者过滤 → 原子接收/会话关联/Turn 入队/cursor 推进 → 可信权限控制 |
| 处理 Turn | 普通应用流程 | 领取 → 路由 → 权限/管理命令或附件准备 → 纯文件回执或 Agent Run → 结果与投递意图提交 |
| 投递 | 独立持久流程 | 领取 Outbox → 格式呈现 → 协议发送 → 成功记录或有界重试 |
| 会话结束 | 事务 + 幂等清理流程 | 检查活动任务 → 归档/任务处置/记忆入队 → 权限清理 → Pi 资源释放 |
| 记忆整理 | 普通应用流程 | 领取 → 绑定模型 → 提炼明细 → 可选合并 → 版本核对 → 发布 |
| 模型认证 | 状态机 + 应用服务 | 开始 → 暂存凭证 → 认证 → 停止新准入/排空在途请求 → 提交或隔离 |
| 权限管理 | 状态机 + 可信命令入口 | 申请 → 确认/拒绝/过期/撤销；确认后的 continuation 去重创建 |

复杂流程通过命名方法和普通分支组织；可复用规则留在领域模块，短流程无需独立文件树。

Conversation 状态机约束生命周期；Turns 状态机约束执行；Delivery 状态机约束发送；授权和认证各有独立状态。业务存储是状态的唯一依据，不新增图状态副本。

## 6. 事务、所有权与跨模块调用

拆分现有 ControlPlane 不意味着拆掉其事务保证。接口按业务目的分离，SQLite Adapter 可以实现多个接口并在同一数据库事务中协作：

1. messaging 的接收提交端口：消息、cursor、会话关联及 Turn 入队原子提交；会话和任务规则由核心给出，SQL 只实现持久化。
2. turns 的完成提交端口：执行结果与 Outbox 意图一起提交；投递 worker 不重跑 Agent。
3. conversation 的结束提交端口：归档与 memory job 入队保持 app.db 同一事务。
4. permissions.db 仍与 app.db 分离；会话权限清理维持幂等补偿。不能假装跨两个数据库存在原子事务。

同步跨模块调用必须经过公开接口。事件用于已发生事实与异步派生工作；关键接收确认、授权消费、结果提交必须等待可靠落库。不得将权限撤销放到拥塞的普通 Turn 队列尾部。

## 7. 恢复边界

当前不做通用进程恢复或任意步骤续跑，不新增 checkpoint 存储。保留现有可靠性与启动策略：

- 启动先取得单实例锁、绑定管理端口，之后归档遗留活动 Session，中断未完成 Turn，不自动重放工具。
- 生成完毕的 Outbox 按现有方式恢复发送；记忆任务恢复阶段处理和重试。
- 活动 Session 内的授权 continuation 继续去重执行；旧 Session 关闭后不跨重启恢复。
- 不承诺 Pi 内部模型/工具调用的精确续跑；未来有明确需求时再对齐恢复粒度和技术选型。
- 外部操作成功但结果未落库时，依靠稳定操作 ID、查询或待核对状态处理，不能盲目重试。

## 8. 实施顺序与验收

以本规格及覆盖表确定迁移和回归范围；不因代码组织重构引入执行引擎。具体阶段计划和实施状态统一记录到 changelog。

建议依次建立模块接口与功能基线、分离协议适配及呈现、迁移能力模块、迁移会话/任务/投递编排、最后清理旧入口。每阶段保持可运行；不一次性改动数据目录和业务 ID。

覆盖表是功能验收清单；source-map 是文件归属审计，不能以文件全覆盖代替行为测试。实现时运行对应 TypeScript 单测、契约和集成检查，并验证图片、PDF、授权续跑、即时撤销、模型切换、记忆版本一致性和真实退出流程。OAuth/API Key、微信和真实模型调用应单列真实验收，不能由 Dry Run 代替。

本规格描述重构要求，不代表相关机制已经实现或验证。


## 9. Workers、Shared 与能力应用服务

- 每个能力模块保留自己的应用服务。例如 artifacts 编排下载、配额校验与入库，memory 编排提炼与合并，models 编排选择与认证，permissions 处理可信授权命令。禁止建立聚合所有能力的万能 Service。
- Worker 负责启动循环、调用领取接口、等待间隔、存活心跳、驱动级退避和退出信号；租约/状态变更通过所属模块接口进行。业务重试、权限判断和过期规则由模块负责。
- Worker 负责发现并触发模块内应用流程。停止领取与取消在途执行分开控制。
- shared 只接受跨模块通用且无业务归属的 Clock、ID、Result 等基础类型；业务模型、Pi 实例、DB 连接、全局 AppContext 和跨域业务 Service 不得放入 shared。
- 协议适配器实现认证头、序列化、响应和错误转换等；其安全协议重试不能替代应用的业务重试，更不能重复不确定的外部副作用。

## 10. 功能要求与验收条件

覆盖表 26 项是本规格的组成部分，必须逐项验收；source-map 记录 109 个源文件的迁移责任，不是功能正确性的证据。

| ID | 规范要求 | 可观察的验收条件 |
|---|---|---|
| R-001-01 | 按模块组织并限制依赖 | 不存在全局 use-cases；entrypoints 只调用公开应用接口；domain 不引用 SDK/SQL/HTTP；跨模块不深层导入内部实现 |
| R-001-02 | Conversation 与 Turns 分工 | 连续输入按顺序处理；即使重复唤醒也不能有两个同会话执行所有者；会话关闭与任务取消遵守既有行为 |
| R-001-03 | 复杂流程显式化 | Turn、记忆整理等流程可定位唯一流程定义及状态；节点调用能力服务；简单查询不被强制图化 |
| R-001-04 | 保持接收与结果事务 | 重复消息不重复入队；故障注入后 cursor 不越过未入库消息；执行结果不会与 Outbox 意图分离 |
| R-001-05 | 投递独立 | 发送失败只重试 Outbox；不重跑 Agent；分段、顺序、typing、稳定 client_id 与死信规则保留 |
| R-001-06 | 权限即时生效 | 长 Run 中撤销能中止受管执行；一次性授权只消费一次匹配尝试；重复确认仅创建一次 continuation |
| R-001-07 | 上下文与文件兼容 | 图片视觉输入、PDF 原件和跨会话文件检索保留；纯上传无 LLM 调用且有上下文回执；重放不重复插入 |
| R-001-08 | Skills 与工具兼容 | 来源优先级、显式/自然语言加载、错误反馈、已有工具集合、沙箱与 Full Access 边界全部保留 |
| R-001-09 | 记忆一致性 | 新会话固定快照；后台提炼/合并可按阶段重试；同用户串行；版本冲突不覆盖新内容 |
| R-001-10 | 模型与认证一致性 | subjectKey 选择跨重启保留；Turn 固定绑定；账号提交等待在途请求排空；失败不覆盖旧凭证；不新增自动 fallback |
| R-001-11 | 生命周期与恢复兼容 | 单实例锁和端口约束保留；退出停止领取并收尾；重启处置遗留 Turn，不重放工具；Outbox 与记忆按原策略恢复 |
| R-001-12 | 观测和管理入口完整 | 原 Trace/Chat/Tree、记忆任务、模型认证页面和健康/指标/debug 接口仍可用；敏感数据脱敏、截断与历史 ID 兼容 |
| R-001-13 | 执行与恢复范围明确 | 无 Graph 引擎、通用 checkpoint 或新增 workflow.db；保留 Outbox/记忆阶段重试及启动中断策略，不自动恢复遗留聊天任务 |
| R-001-14 | 数据与发布兼容 | 既有数据目录、主体与账号作用域不变；迁移保留关键事务；构建包含提示词和沙箱 worker；Dry Run 与正式模式分开验证 |

## 11. 验证方式与实施约束

- 先记录基线，再按迁移风险运行相关 TypeScript 单元、契约和集成测试；依赖方向通过静态导入检查或架构测试验证。
- 关键事务、重复唤醒、取消和版本冲突使用有意义的故障注入场景验证。只移动文件不需要机械补充镜像测试。
- 实施完成按 package.json 执行适用的 lint、typecheck、测试和构建；禁止未经用户明确请求执行 go build、go test、go vet。
- 真实微信、OAuth/API Key 和模型文件输入的验收单列；无真实证据时标为未验证，不得以 Dry Run 或旧验收材料替代。
- 保留未关联改动，不提交运行数据、凭证或私人对话。提交、推送和真实验收分别报告。
- 实施阶段计划与验证结果写入 changelog；本 spec 维护当前约束与验收条件，不维护逐日进度。

## 12. 已落实的实施决策

| 决策 | 必须得到的结论 | 影响范围 |
|---|---|---|
| 流程组织 | 普通应用函数/服务与明确状态转换；当前不引入 Graph，未来选型需先与用户对齐 | 应用流程 |
| Pi 运行边界 | 一次 Pi prompt 由 Agent Runtime 调用；不恢复其内部工具游标。Turn 启动恢复保持中断取消，权限 continuation 仍是新 Turn | Turn 流程与故障处置 |
| 存储接口拆分 | MessageStore.ingestBatch、TurnStore.completeTurn、SessionLifecycleRepository.endSession 保留原子提交；DeliveryStore、TraceQuery、ConversationContextStore 分离读取/投递职责，SQLite Adapter 组合实现 | ControlPlane 拆分 |

上述决策服务于已确认的模块分层；实现与验收证据见 changelog。Harness 的长程目标与自动推进另属 H-001，不纳入 R-001。




## 13. 实施落点补充

- 公开应用/领域/端口由 modules/<name>/index.ts 导出，静态导入检查纳入 npm run check。不通过兼容空目录维持旧 use-cases 导入。
- CLI 文件只负责启动，首次登录与 onboarding 的组装保留在 bootstrap；Admin 依赖 AuthManagement、TraceQuery、MetricsQuery 等核心接口。
- ProviderAuthService 管理认证生命周期；PiAuthBackend 适配登录/凭证，SqliteAuthOperationStore 适配原子提交。PiProviderAuthentication 保留薄组装入口以兼容现有构造接线。
- ReplyPresentation 管回复分段与 typing；FileLibraryService 管文件查询/可用性；executeTool 管实时授权与执行分派。Pi 工具只做参数/结果桥接。
- Turn 顺序处理控制命令、附件、回执或 Agent 调用、结果提交；Memory 顺序处理提炼、可选合并、版本核对和发布。授权 continuation 保持新 Turn；业务启动恢复仍取消旧会话任务。
