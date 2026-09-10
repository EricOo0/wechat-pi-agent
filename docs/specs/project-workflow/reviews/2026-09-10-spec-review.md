# W-001-7 规格与实现核对

> 历史预检记录：以下摘要对应此前工作区版本，不覆盖随后提交检查发现的修复。最新本地测试见 [原始输出](../evidence/tests-2026-09-10.txt) 和 [版本指纹](../evidence/tests-2026-09-10.json)；本次暂存版本的核对报告由 pre-commit 核对通过后另行生成。

范围：新增 project-spec-review 和 pre-commit 前置核对，不重新宣称全部 W-001 完成或 Codex Stop 已信任。

阶段：completion（仅 W-001-7）。基线 HEAD：`f549d22bce908349ac57349b855232825e7be204`。本次核对对象是未提交工作区，非 Git 暂存版；文件 SHA256 见下表。

| 条款 | 结论 | 实现与验证依据 |
|---|---|---|
| W-001-7：核对先于同步 | 符合 | pre_commit 先调用 spec_review；失败测试确认同步函数未调用 |
| W-001-7：完成范围缺口阻断 | 符合 | audit_edits 对 completion 的 missing/deviates/unverified 追加阻断项；隔离缺失测试通过 |
| W-001-7：阶段交付保存报告 | 符合 | incremental 缺口保留在专题 reviews，spec 只增加导航；暂存后命中缓存测试通过 |
| W-001-7：不改要求掩盖偏差 | 符合 | 后置同步禁止改写 specs 正文/reviews；隔离测试确认原规格不变 |
| W-001-7：版本变化重新检查 | 符合 | 缓存绑定 HEAD/index/规则，规格新增要求后旧核对失效测试通过 |

自动化：21 项 Python 隔离测试通过。真实 codex-cli 0.144.6 在临时仓库运行两阶段 pre-commit：第一次生成报告、reviews 索引和 spec 导航并停止提交；只暂存生成文档后第二次命中缓存成功提交。主项目未暂存/提交，未运行业务或发布验收。

| 工作区文件 | SHA256 |
|---|---|
| scripts/project-workflow/workflow.py | 9087813beee725ec1d9739dc22d68a1f067ec845c4e3531b7f6dab93945f76e7 |
| scripts/project-workflow/spec-review.schema.json | 32b614fe1ad134672d216315f9a2862edafec33bbda36bab37781159e3fb2920 |
| .agents/skills/project-spec-review/SKILL.md | bcf1ef2094a916fdea1826ee5c0ef32876760483b862880a2ee74debdc8ebbce |
| test/project-workflow/test_workflow.py | 5fa7a2ec102a8820b80fd748f0ae9afe67b11c7ea5e8d9358c645523c57c53f3 |
