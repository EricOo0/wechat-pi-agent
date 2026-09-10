# 文档自动同步范围核对

用户明确要求取消文档内容冻结。W-001-2/3/7/8：conforms / local。后置同步允许索引和规格正文变更，当前审查报告由前置阶段保留；修改后仍停止提交、不自动暂存。路径、元信息、未暂存保护、错误阻断和 implemented 就绪依据保留。

[31 项工作流测试](../evidence/document-sync-tests.json)通过，包括索引同步、正文与状态联合更新、无依据晋升拒绝、未暂存保护及超时处理。stage=completion，implementation_ready=true；没有扩展提交/推送权限。[脚本](../../../../scripts/project-workflow/workflow.py) · [Skill](../../../../.agents/skills/project-change-sync/SKILL.md)。
