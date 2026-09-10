---
name: project-learning-sync
description: 开发或排障任务收尾时，依据当前会话已验证的发现，按需更新项目 Runbook/Wiki；无新知识时不写入。
---

# 任务经验沉淀

根据当前任务上下文判断，不从最终 diff 猜测失败经历。读 docs/runbook/README.md、docs/wiki/README.md，先查已有相关专题。

- 可执行排障/操作方法写 runbook：症状、根因证据、步骤、成功信号、适用版本和日期。
- 可复用原理/机制/取舍写 wiki：来源、事实/解释/推测分开；规范以 spec 为准，链接引用，避免第二份规则。
- 已有主题优先更新；未确认原因、偶发超时、普通修字等不强行沉淀。无新增可靠结论时 no_change。
- 可自动更新，无需用户逐次要求；仍遵守用户在本次任务中只读/不改动等明确限制。
- 不保存凭证、原始对话、用户私有内容，不修改 Codex 的全局 memories 文件夹。
- 更新对应索引和必要的本次 changelog；不在这一步重写 spec/架构，也不自动 commit/push。
- 正常交付先执行本 Skill，再进入提交阶段。Stop 是兜底；若提交已发生，说明新增文档尚未提交，不自动追加提交。

Hook 提供 session/turn 参数时，完成检查（包括 no_change）后运行其给出的 `learning-ack` 命令。没有参数时执行 `python3 scripts/project-workflow/workflow.py learning-ack`，使用 CODEX_THREAD_ID 记录当前任务。只在真正检查之后确认，不用确认代替检查。
Stop continuation 内只执行一次；发现用户仍在讨论/等待输入/未完成工作，则不沉淀，并确认本次跳过原因。禁止重新启动 codex 或触发自己的 Hook。
