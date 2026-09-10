---
{
  "id": "H-001",
  "title": "通用 Task 执行与控制",
  "kind": "feature",
  "maturity": "experimental",
  "status": "implemented",
  "lifecycle": "planned",
  "affects": [
    {
      "id": "R-001",
      "sections": [
        "R-001-02",
        "R-001-03",
        "R-001-06",
        "R-001-11",
        "R-001-13"
      ]
    },
    {
      "id": "M-001",
      "sections": [
        "M-001-3",
        "M-001-5"
      ]
    }
  ],
  "changes": [
    "F-002",
    "H-002"
  ],
  "effective": null
}
---

> 实现核对：[版本化核对记录](reviews/README.md)

# H-001：通用 Task 执行与控制

用户已确认统一 Task、申请完成后 Review、HITL 及累计 30 轮 ReAct 的流程，并已授权开始实现。第 9 节的行为选择已确认并落实；本地实现核对与 146 个测试及完整检查已通过，不代表已经部署。[实现核对](reviews/2026-09-10-local.md) · [验证证据](evidence/README.md)。[状态](../../changelog/planned.md#h-001-agent-harness) · [架构讨论图](../../architecture/proposals/agent-harness/task-architecture.md)

## 1. 目标与已确认范围

普通聊天和持续工作统一使用 Task。简单问答通常一次 Run 完成，复杂目标可以经过多次 Run；系统保留进展，并在执行 AI 申请完成时独立 Review。首期不按任务类型或“完成强度”建立不同的判定框架。

- 新增 Task、Task Manager、Review 与任务存储，属于同一 tasks 模块的不同职责，不拆成多个服务。
- Conversation 管交互与生命周期，Turns 管执行请求的顺序、去重和运行所有权，Agent Runtime/Pi 执行一次 Run。
- 一个 Conversation 保留多个历史 Task，但同一时刻最多一个未关闭 Task；一个 Task 可以有多个 Turn/Run，同一会话同一时刻最多一个 Run 修改 Agent 状态。
- 新消息默认关联最新未关闭 Task，无需额外 AI 路由；没有未关闭 Task 时创建。意图改变作为同一 Task 的新输入并更新目标版本，不重置预算。控制命令直接操作 Task，不递归创建任务。
- 复用 Context、Memory、权限、工具、Skills、文件、模型管理与本地沙箱。任务工作状态与用户长期记忆分别管理。
- 使用普通应用流程和明确状态转换。当前不引入 Graph、checkpoint、跨进程自动续跑、多 Agent 或远端执行环境。

## 2. 数据与职责

以下为逻辑契约；物理存储和接口映射见第 11 节。

| 对象 | 关键内容 | 所有者 |
|---|---|---|
| Task | id、可信 owner、conversationId、goal、constraints、revision、status、progress、evidence、reactLimit（初始 30）、reactUsed、reviewCount、waitCondition、stopReason、时间 | tasks |
| Task Event | taskId、事件序号、目标版本、请求/执行关联、变更类型、时间、脱敏信息 | tasks |
| Execution Request / Turn | 来源、taskId、taskRevision、稳定请求 ID、输入引用、执行及取消状态 | turns |
| Run Outcome | disposition（continue/waiting/request_completion）、进展、剩余工作、产物/证据引用、问题和用量 | Runtime 输出，tasks 消费 |
| Review Result | completionRequestId、taskRevision、decision（approved/revise/waiting）、reason、gaps、nextAction、question、finalResult 引用 | Review |

Task 通过关联查询运行细节，不复制整份 Trace。目标或约束修改递增 revision；旧版本结果可保留为历史，但不能据此完成或推进新版本。

Task 需要的持久化能力由 TaskStore 端口定义，SQLite Adapter 实现。任务控制不得直接依赖微信协议、Pi 类型或 SQL。

## 3. 执行闭环与计数

```text
创建或关联 Task
    → Task Manager 核对目标版本、控制状态与剩余 ReAct 预算
    → 有预算：Turns 调度，Agent Runtime/Pi 执行
        → continue：保存进展，回到预算检查
        → waiting：保存问题/授权关联，发消息给用户，进入 WAITING
        → request_completion：保存结果与证据，调用 Review
            → approved：Manager 再核对目标版本/控制状态，完成并投递结果
            → revise：保存缺口，回到预算检查
            → waiting：保存待确认问题，发消息给用户，进入 WAITING
    → 无预算：PAUSED，保存进展/缺口并通知用户
```

Review 默认采用轻量交付检查：核心结果存在且没有具体重大缺陷时通过，不为未被用户要求的额外核验或美化反复返工。仅“无法独立确认”不等于失败；revise 必须指出已观察到的缺失、失败、矛盾或答非所问，并给出最小补做动作。用户明确要求严格验证时按其要求处理；权限、目标版本和附件存在性不放宽。历史 Review 建议不成为额外用户需求。

**执行 AI 只能申请完成，不能直接标 COMPLETED。Review 仅在 request_completion 时调用，不在每个 Turn、工具调用或 continue 后调用。** 普通文本回复可以是进度或提问，不作为机器判定完成的信号。

- 每个 Task 初始最多 **30 轮 ReAct**，在多个 Turn/Run 间累计，不因继续、HITL 答复或 Review 驳回而重置。
- 1 轮 ReAct 指执行 Agent 的一次模型调用及其触发的工具批次；同批多个工具仍算一轮。一次 Run 内可以包含多轮，不能把限制实现成 30 个 Turn 或 30 次工具调用。
- Review 模型调用单独计数，不占执行 Agent 的 30 轮。它仍须遵守权限、取消和 Provider 请求协调。
- 第 30 轮若返回 request_completion，允许直接进行最终 Review，无需再经过有预算判断。通过则完成；有缺口且无剩余预算则暂停，不启动第 31 轮。
- HITL 等待期间不轮询模型、不消耗 ReAct 轮数；收到匹配答复后使用剩余预算。预算耗尽需用户明确追加，不能由 Agent 或 Review 自动补充。
- 重复结果回调/完成申请通过稳定 ID 去重；同一完成申请不重复生成逻辑 Review。Review 失败属于错误处理，不启动无界自审循环。

暂停、取消、系统错误可以由 Manager 直接处理，不必调用 Review。预算耗尽不等于目标完成。Loop 计数在实际执行模型的边界采集，不能只信任模型自报用量；Pi 事件/调用封装和流式失败的具体计数契约见第 9 节。

## 4. 状态与控制

任务状态与控制契约如下。

| 状态 | 含义 |
|---|---|
| QUEUED | 已接受，等待领取；可暂停或取消 |
| RUNNING | 执行 Agent 正在工作；按结构化 disposition 继续、等待或申请完成 |
| REVIEWING | 完成申请已接受，正在独立 Review；仍响应取消/暂停和目标版本变化 |
| WAITING | 等待明确的用户信息或授权，保存等待类型与关联 ID |
| PAUSING | 已请求暂停，禁止新执行，等待当前 Run 收尾 |
| PAUSED | 已停止推进；明确继续时根据最新状态启动新 Run |
| CANCELLING | 已请求取消，当前执行尚未收尾；不再自动继续 |
| COMPLETED | Review 通过且 Manager 确认目标版本与控制状态有效 |
| FAILED | 当前任务因不可继续的执行错误结束，保留原因 |
| CANCELLED | 用户取消已处理完毕，不再推进 |

暂停/取消先可靠记录，再向当前运行句柄发信号；不能只排到普通 Turn 队列尾部。收尾完成后才报告已暂停/取消，已有外部副作用不回滚。

重复创建、控制、完成回调、授权确认须幂等；终态任务的迟到事件不能重新激活任务。操作身份来自可信接入上下文，工具参数不能冒充其他用户或确认自己的授权。

## 5. 完成 Review

Review 是 Task Manager 调用的独立应用组件，通过单独的模型核对目标、用户约束、执行结果与实际证据。首期不引入强弱等级、任务类型分类或通用确定性验收 DSL。

Review 输入至少包含当前目标版本、约束、历轮有效进展、已有用户答复、执行 AI 的完成申请、产物引用，以及必要的模型/工具结果。不能只看执行 AI 最后一句“完成了”，也不无限复制全部 Trace。

| 结果 | 处理 |
|---|---|
| approved | 提交完成说明、最终结果或引用；Manager 校验版本/控制状态后完成 Task |
| revise | 给出具体缺口与下一步要求，Manager 根据剩余预算安排执行或暂停 |
| waiting | 给出需要用户确认/补充的问题，进入 WAITING |

Review 通过不能越过已发生的取消或新目标版本；旧版本结果保存为历史，不推进当前任务。Review 可能误判，需要保留判断依据与证据引用，不宣称它能通用证明答案正确。

Review 不能自行修改用户目标或删掉失败要求来宣布完成。需要额外读取文件或执行验证时，也必须走现有权限与受控工具，不获得额外授权。模型绑定和证据输入预算见第 9 节。

执行 AI 的 waiting 与 Review 的 waiting 复用同一 HITL 机制：持久化问题和关联 → Outbox 投递 → 接收匹配答复 → 更新 Task → 使用剩余预算继续执行。等待不能创建忙循环，重复答复不能创建重复续跑。

## 6. 接入现有模块

| 模块 | 接入契约 |
|---|---|
| Messaging | 普通输入统一创建/关联 Task，控制命令直接操作目标 Task；通知与最终结果继续走 Outbox |
| Conversation | /new 归档旧 Conversation，取消未完成 Task 及待执行请求；已完成 Task 保留，后续输入进入新会话 |
| Turns | 明确区分 user_message、task_continue、permission_continue；内部续跑不伪造微信 Inbox |
| Agent Runtime | 返回结构化 Run Outcome；当前 Run 的模型绑定和取消边界不变；在实际模型调用边界累计 ReAct 用量 |
| Context | 每轮读取最新目标版本、约束、进展、待办和证据，不仅依赖聊天历史 |
| Permissions | 复用可信确认；Task 等待和现有 continuation 只能有一个续跑创建者，避免双重入队 |
| Models | 新 Run 与 Review 开始时绑定当前模型，本轮固定；旧失败绑定不能自动换账号重做 |
| Artifacts / Memory | 按现有用户归属管理文件与产物；Task 中间状态不写入长期 Memory 充当执行游标 |
| Admin / Trace | 查看目标、进度、Run 关联、等待/停止原因、检查证据；保留现有脱敏规则 |

本轮结果、Task 状态、必要通知和下一执行请求须在关键事务中一致提交。业务接口分属模块，由 SQLite Adapter 实现跨表事务；不以异步事件代替关键持久化确认。

下一请求使用 taskId、taskRevision、执行序号等稳定标识去重。领取时重查状态、版本、预算和会话有效性，取消不能被此前生成的续跑越过。

首期继续当前单 Turn worker 的执行额度。是否设置独立任务调度 Worker 属于实现选择，但不能形成绕过 Turns 的第二条执行链。

## 7. 持久化与中断边界

保存任务目标、进展、证据和事件用于查询与审计，不保存进程调用栈、Pi 工具执行游标或通用 checkpoint。

重启后保留资料，未完成任务停止自动推进并记录中断原因，不自动重放模型或工具。人工继续与旧 Session 归档的衔接见第 9 节。

保留现有消息去重、Outbox 重试、记忆阶段任务、权限作用域、模型绑定及启动收尾。数据迁移保持旧 Turn/Session/Outbox ID；必须处理当前 Turn 强制关联 inboxId 的约束，不伪造来源解决迁移。

## 8. 验收条件

| ID | 验收条件 |
|---|---|
| H-001-1 | 聊天与持续工作共用 Task 模型；普通输入创建/关联 Task，控制操作不递归建 Task；重复请求不重复创建 |
| H-001-2 | 一个 Task 可经过多次 Run，进展和运行关联可查询，Run 结束不直接等同目标完成 |
| H-001-3 | 暂停/继续/取消有明确状态，重复控制幂等，取消后不再产生或领取续跑 |
| H-001-4 | 重启后保留资料但不自动续跑；不盲目重放外部副作用，不承诺工具级恢复 |
| H-001-5 | 只有 request_completion 触发 Review；只有 approved 且版本/控制状态有效才能完成，continue/waiting 不调用 Review |
| H-001-6 | 渠道使用统一应用接口；内部续跑有独立来源，不伪造微信输入 |
| H-001-7 | 目标修改递增版本，迟到结果不推进新版本；同会话执行所有权不冲突 |
| H-001-8 | 等待时不忙循环；匹配输入只产生一次继续，失效授权不能执行 |
| H-001-9 | 同一 Task 最多 30 轮执行 Agent 模型调用，跨 Turn/Run 不重置；HITL 等待不耗轮数，多个工具同批不重复计数 |
| H-001-10 | 结果、Task 状态、下一请求和投递意图的事务/幂等性有故障场景验证 |
| H-001-11 | 原文件、图片、Skills、模型、权限、记忆、Trace 和生命周期能力兼容；/new 取消旧会话未完成 Task |
| H-001-12 | 第 30 轮申请完成仍可 Review；驳回且无预算则 PAUSED；无用户明确追加不得执行第 31 轮 |
| H-001-13 | Review 单独计数，同一完成申请去重；revise 携带缺口继续，waiting 复用 HITL，不能自行追加预算 |

## 9. 已确认行为与实现契约

用户已确认最新未关闭 Task 归属、最终 JSON 和以下首期行为。工程限额沿用现有模型生成服务的输入与超时约束。

| 决策 | 当前契约 |
|---|---|
| 新消息归属（已确认） | 新消息归最新未关闭 Task，同会话最多一个未关闭 Task；保留历史输入，新增输入更新版本，旧结果不能完成新意图 |
| Outcome 协议（已确认） | 最终结构化 JSON，经严格 schema 校验；格式不合法暂停，不用自然语言关键词推断完成 |
| Pi ReAct 计数（行为已确认） | 实际发起的执行模型调用，包括失败与重试，均计入 30 轮；实现时在请求发出前原子检查/消费，不能发出第 31 次 |
| Review 接入 | 单独模型调用，无工具，当前模型单独绑定，maxRetries=0；沿用 120 秒超时和 160000 字符输入上限，必要时裁减旧执行证据并明确标记；仍超限则暂停而非静默省略目标 |
| 模型绑定（已确认） | 新 Run 与 Review 在开始时绑定当前模型，之后固定；认证版本遵循现有 gate |
| 闲置归档（已确认） | WAITING/PAUSED Task 阻止闲置归档；主动 /new 仍关闭会话并取消未完成 Task |
| 用户追加预算（已确认） | 必须显式指定追加轮数，AI 不自动追加 |
| 中断后（已确认） | 重启后任务仅可查看，不跨会话继续，不自动恢复 |

## 10. 规格关系与下一步

H-001 是待生效的新能力，R-001/M-001 的 changes 回指它；本地实现尚未声明取代这些规格的已发布行为。原含 Graph/通用恢复的 Harness 提案仅作历史参考。

已实现 Task 领域、存储、JSON 执行与 Review、命令控制、内部续跑、预算、管理页和迁移；验证见本专题 evidence。当前未部署，真实账号/微信验收独立记录。


## 11. 当前实现接口与数据兼容

- `/task status`、`/task list` 查看当前或历史任务；`/task pause`、`/task cancel`、`/task resume` 控制当前未关闭任务；`/task budget N` 显式增加正整数轮数，并让已暂停任务继续。重复同一消息不重复加预算。管理命令单独发送；附带附件时按普通任务输入处理，避免丢失附件。
- `/admin/tasks` 展示当前用户任务；`/debug/tasks`、`/debug/tasks/:id` 返回状态、用户输入、事件和运行关联。只读界面复用现有本机 Admin 部署边界，控制入口为可信微信命令。
- Task.goal 保留初始目标摘要；实际有效意图由按序用户输入、回复关联 replyTo 和最新版本共同表达，不把“好的”等短答复覆盖为目标。没有目标的纯文件上传先保存并记录上下文，不调用执行模型或 Review，Task 进入 WAITING 等待目标说明；向已有明确目标的 Task 补发文件时，保存并同步上下文后继续执行。
- migration 9 增加 tasks、task_inputs、task_events、task_reviews、task_control_receipts；Turns 增加 task_id/task_revision/source/input_text。重建 Turns 将 inbox_id 的唯一约束缩小至 user_message；保留所有旧 ID/关联数据，并验证外键完整性。
- 内部请求引用真实 Inbox 作可信来源，但使用独立 Turn ID、source 和 input_text；不插入伪造微信消息。Task 结果、下一请求、Outbox 保持同一业务事务；提交失败时任务暂停，不留在无人执行的 RUNNING/REVIEWING。
- 模型调用前原子消费预算，任务版本或状态失效即拒绝。Task 执行关闭 Provider 内部自动重试，Pi 重新发起的模型轮次仍经过同一消费点；Review 和后台记忆不计入执行 ReAct 预算。
- Review、暂停/取消和新输入均受版本及运行控制约束；迟到结果不提交最终答复。任务失败/协议异常采用 PAUSED 保留信息供用户处理，终态任务不被迟到事件重新激活。
- Memory 和 Trace 明确区分 user_message 与内部执行来源，内部续跑不当作用户重复发言。WAITING/PAUSED 阻止闲置归档，重启归档旧会话并取消未完成 Task，仅保留历史可查询。
