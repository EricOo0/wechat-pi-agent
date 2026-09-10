---
{
  "id": "W-001",
  "title": "项目规格与知识维护自动化",
  "kind": "feature",
  "maturity": "experimental",
  "status": "implemented",
  "lifecycle": "planned",
  "affects": [],
  "changes": [],
  "effective": null
}
---

> 实现核对：[版本化核对记录](reviews/README.md)

# W-001：项目规格与知识维护自动化

## 目标和范围

通过项目级 Skill 和 Hook，让提交包含必要的规格、变更记录和架构维护，让经验在任务收尾时按需进入 Runbook/Wiki。不依赖用户记得逐次调用；不改变聊天助手业务逻辑，不自动提交或推送。

## 四个 Skill

| Skill | 触发 | 内容 |
|---|---|---|
| project-spec | 显式调用 | 写规格、关系和地图 |
| project-spec-review | 开发完成及 Git pre-commit | 先核对受影响条款、实现与验证依据，记录偏差和遗漏 |
| project-change-sync | 开发收尾及 Git pre-commit | 根据本次实际变更检查 spec/changelog/architecture/map |
| project-learning-sync | 开发收尾及 Codex Stop | 利用当前任务上下文按需更新 Runbook/Wiki |

入口位于项目 `.agents/skills/`，不放入供微信助手加载的业务 `skills/`。Skill 本身不授予提交或推送权限。

## 规格头部与生命周期

新建受管 spec 使用 `---` 包围的 JSON frontmatter，它是 YAML 的合法子集；示例见 [模板](../../../scripts/project-workflow/spec-template.json)。使用 JSON 避免 Hook 依赖额外 YAML 解析器。已有未标头的历史正文允许逐步迁移，不把 history/evidence 当现行规格。

| 字段 | 规则 |
|---|---|
| id / title | 稳定、全库唯一 ID 与标题 |
| kind | feature / patch / sunset |
| maturity | experimental / stable，独立于变更类型 |
| status | draft / accepted / implementing / implemented / effective / abandoned |
| lifecycle | planned / active / deprecated / retired |
| affects | `[{"id":"F-001","sections":["F-001-2"]}]`；patch/sunset 必填 |
| changes | 对影响本规格的变更 ID 的回指，由 specs-sync 自动维护 |
| effective | 未确认时 null；effective 状态须包含 version、YYYY-MM-DD 的 date、仓库相对路径 evidence |

`affects` 是关系声明源，`changes` 和 [规格地图](../MAP.md) 从它生成。主 spec 说明当前行为和待生效变更；变更生效后正文收敛，不形成 patch 链。多份未完成变更修改同一条款时，作者须说明冲突与先后顺序，检查器不自动判定覆盖关系。

有发布证据才能标 effective；提交不是发布。status 是变更交付阶段，lifecycle 是能力是否支持，不能互相替代。部分 sunset 修改条款；完整下线保留 retired 声明和替代链接。试验性功能写清启用范围、退出条件。

## Git pre-commit

1. 读取实际 Git index，复制普通暂存文件到临时快照；不复制工作区未暂存内容，不跟随符号链接。
2. 先独立调用 codex exec 执行 project-spec-review，再调用 project-change-sync；各阶段最多 600 秒。均为只读沙箱，忽略用户配置及规则，关闭子进程 Hook。
3. 只接受 README 与 docs/specs、docs/changelog、docs/architecture 的 Markdown；不接受 source、Hook、Runbook/Wiki 或 history/evidence/archive 修改。
4. 在临时树上验证链接、规格字段、关系和地图；确认 HEAD/index/规则未变，目标文件没有未暂存修改，才应用到工作区。
5. 有修改则停止本次提交，要求开发 Agent 或用户核对并暂存。无修改或下一次暂存树与已检查结果完全一致时允许提交。

前置核对输出 stage（incremental/completion/not_applicable）、覆盖范围和逐条 conforms/missing/deviates/unverified/not_applicable 结论，含代码与验证依据。明确阶段交付可保留记录中的未完成项；声明完成范围内 missing/deviates 和本地 unverified 阻断，外部验收按 verification_scope 规则处理。新增回归或未接受偏差即使阶段提交也应放入 blockers。

deviates 在所有交付阶段均强制阻断；接受设计变化时先修改并确认规格，再重新核对。未暂存的检查器、Skill 或 Hook 规则会在模型调用前拒绝；模型提示词和 schema 从暂存快照读取。

成功或允许阶段提交的核对报告由脚本生成到 docs/specs/<topic>/reviews/<暂存指纹>.md，并维护 reviews/README.md；spec 顶部只自动插入该索引链接。报告保存 HEAD、暂存/规则指纹和插入导航前的规格内容 SHA256；与最终预计暂存树匹配的缓存才可放行。代码、规格或检查规则变化会重新核对。

失败报告保存在 Git 私有目录 project-workflow/spec-review.md 和 spec-review.json，供当前开发任务定位；失败时不改 spec、不执行文档同步。后置文档同步可以修改 spec 正文、索引、导航和架构说明，不以内容冻结拒绝正常同步；需要记录设计与实现差异及原因，保留前置审查证据。晋升 implemented 仍需 implementation_ready=true 和本地验证依据。修改后停止提交，由当前开发任务核对、暂存后继续；文件范围、未暂存改动保护和检查失败阻断保留。

缓存绑定 HEAD、暂存文件模式/对象 ID、检查器与 Skill 版本。子进程禁止递归提交，锁防并发重复调用；超时、认证失败和无效输出明确失败，不自动放行。不截断过大的 diff 后假称审查完成：超过 1 MiB 要求拆分提交。package-lock 不作为语义 diff，但仍包含在快照与缓存标识中。

检查器不推断踩坑、不执行业务测试、不运行仓库代码。它校验文档结构，不能机械证明语义或发布证据真实。本地 Hook 可以被 Git 原生绕过，不能视为安全边界；当前不新增 CI 平台配置，未来可在 CI 调用同一 check 命令。

## Codex 收尾

UserPromptSubmit 记录会话级工作区/HEAD 指纹和是否可能为开发排障请求，不保存用户正文；Stop 发现变化或开发排障任务时最多追加一轮经验检查。stop_hook_active、issued 指纹与显式 learning-ack 防止无限续轮。

继续轮由当前 Agent 读取 project-learning-sync，使用原任务证据；已验证操作写 Runbook，原理解释写 Wiki，无价值则 no_change。普通讨论和用户明确只读时不写文件。正常交付先沉淀再提交，Stop 是兜底；提交后新增文档应报告未提交，不能擅自追加提交。

Hook 不读取或解析不稳定的会话 transcript。无初始化记录的新装会话不会自动推断本次是否写入，正常 Skill/AGENTS 收尾约定仍生效。/hooks 必须信任新 Hook 定义后，Codex 才会自动调用；不写 trusted_hash、不绕过该信任机制。

## 验收

- W-001-1：project-spec 只显式触发；其余三个可隐式调用；引用文件和 frontmatter 校验通过。
- W-001-2：staged 快照与未暂存修改隔离；建议不能触碰源码、符号链接及非允许文档。
- W-001-3：文档修改后提交停止，Git index 保持不变；下一次相同建议不重复追加；新增变更使缓存失效。
- W-001-4：缺失反向关系、重复 ID、生效证据缺失、地图过期与断链被发现。
- W-001-5：Stop 对普通未改动任务不追加轮次；开发任务最多兜底一次；ack 后直接结束；不覆盖其他全局 Hook。
- W-001-6：失败/超时/递归提交不放行；错误不泄露原始认证日志。安装不覆盖既有 hooksPath 或原生 pre-commit。
- W-001-7：前置核对失败时不调用同步；completion 的遗漏/偏差/验证缺口阻断；incremental 的缺口保存在版本化报告。后置同步可更新文档内容，保留前置审查证据；修改后停止提交并展示差异。
- W-001-8：实现与本地验证齐备后可在提交前晋升 implemented；同步状态与文档内容，无前置就绪依据时不得晋升；不要求或推断发布状态。

适用条件：Python 3.10+、Git、可运行且已登录的 Codex CLI。当前本机版本在交付记录中登记。安装及故障处理见 [操作说明](../../runbook/project-workflow.md)，验证证据见 changelog。


## implemented 的更新时机

实现与必要本地检查完成 → project-spec-review 核对 → project-change-sync 更新 implemented → 暂存并提交。不是 commit/push 后才修改，也不是 commit 成功就无条件完成。

implemented 表示整份规格的代码实现完成且本地验证通过；局部阶段或本地证据不足保持 implementing。部署/真实账号待验收单列，effective 仍须发布版本、时间和证据。Hook 用 implementation_ready 接收前置判断，允许严格的状态单字段晋升并生成地图；其他要求不变。

核对报告的 stage 与实现状态分别表达范围：整份交付仍有明确外部验收项时报告可为 incremental，但只有本地实现范围全部满足才能 implementation_ready=true。不能将未完成代码或本地验证缺口当作外部验收。

验证范围结构化为 verification_scope=local/external。实现就绪且未声明 effective 时，completion 报告允许明确的 external/unverified 待验收；本地缺口仍阻断完成，任何阶段本地 unverified 都不得晋升 implemented。effective 的外部未验证仍阻断。此规则区分实现完成与发布，不允许重新标注本地缺口绕过验证。

文档内容同步策略与最新验证：[核对记录](reviews/document-sync.md)。
