---
name: project-spec-review
description: 开发完成或提交前核对受影响规格与代码的一致性，记录遗漏、偏差、验证缺口及版本化证据；先于文档同步执行。
---

# 规格与实现核对

读取 AGENTS.md、docs/specs/MAP.md、相关现行 spec 和本次变更。仅检查受影响范围，同时检查必要调用方和回归约束；不机械重审所有规格。

- 每项结论对应稳定条款 ID，给出代码位置、已有测试/验证依据；只有测试文件存在不等于测试已运行。
- 结论为 conforms / missing / deviates / unverified / not_applicable，分别表示符合、未实现、偏差、无法确认、本次不涉及。
- stage=incremental 表示明确的阶段交付，可记录尚未覆盖的要求；stage=completion 表示本次声明完成的范围，该范围内 missing/deviates 和本地 unverified 必须阻断完成；外部待验收按下述结构化范围处理。不能将回归或新增偏差伪装为“阶段未完成”。
- 偏差默认修实现；如需变更要求，报告原因、影响、所需决策，不自行修改规格让代码看起来符合。核对本次同时修改 spec 和代码的情况，检查 diff 中是否存在未经明确依据的要求弱化。
- 报告放 docs/specs/<topic>/reviews/，spec 顶部只链接核对索引；报告记录基线、暂存指纹、规格指纹、覆盖范围和证据，不声称上线。
- 无关联 spec 时明确 not_applicable 和理由；业务行为变化找不到规格必须报告阻断。纯文档迁移/排版可无规格核对项目。

## Hook 模式

只读隔离的暂存树和差异，按传入 schema 返回 stage、scope_reason、specs、blockers；不得运行测试、仓库脚本、网络、git 或子 codex，不写任何文件。
specs 每项包含 path（实际受管 spec 路径）、implementation_ready（是否全部代码实现及必要本地验证已完成）、findings（requirement、status、code、verification、verification_scope、reason）。code/verification 为可追溯路径、位置或明确的缺失说明。
不要遗漏本次声明完成范围中的条款，不自行假定不存在的运行结果。无法确定交付范围时列入 blockers，而不是任意按 completion/incremental 放行。
当前暂存指纹的报告由本次核对通过后生成；不要求它预先存在而造成循环阻断。已有旧报告仅适用于其版本。核对生成逻辑、测试产物和对应文件哈希；只读审查无需重跑已提供且版本匹配的测试，但必须区分读取证据与亲自执行。
脚本保存不可由后续同步覆盖的报告；pre-commit 自动调用本 Skill，普通开发可提前调用。

implementation_ready 只有在整份规格的实现范围无开发遗留、无未处理偏差且必要本地检查有版本匹配证据时才为 true。局部阶段完成、本地验证不足均为 false；仅明确列出的部署/真实账号外部验收待完成可以保留，但必须在 findings/reason 中说明。这个判断不代表发布，也不修改 spec。

verification_scope 必填 local 或 external。代码、单测、静态检查、本地集成都属于 local；仅部署、真实账户或明确外部环境验收可标 external。不得将本地证据缺失改标 external。实现就绪且未声明 effective 时，external 的 unverified 可保留为待验收；local 的 unverified 不可晋升 implemented。
