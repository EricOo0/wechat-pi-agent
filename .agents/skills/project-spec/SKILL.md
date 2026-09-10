---
name: project-spec
description: 手动创建或更新本项目的 feature、patch、sunset 规格，维护生效状态、双向关系和规格地图。仅显式调用。
---

# 项目规格

先读 AGENTS.md、docs/README.md、docs/specs/README.md 和 docs/specs/project-workflow/spec.md 的规格契约。
用户指定本 Skill 时才执行；普通开发同步已有规格由 project-change-sync 负责。

- 找已有专题，判断新 feature、patch 或 sunset；experimental 是 maturity 属性，不是第四种变更类型。
- 写到 docs/specs/<topic>/spec.md；复杂未生效变更可用同专题 changes/<id>.md，简单修复只关联原规格。
- 用 scripts/project-workflow/spec-template.json 的 JSON frontmatter（合法 YAML 子集）登记元信息。填写目标、范围、行为和验收即可，其他内容按复杂度添加，不强制第二份 design。
- affects 包含原 spec 的稳定 ID 和受影响条款。原 spec 的 changes 回指新 ID；执行 `python3 scripts/project-workflow/workflow.py specs-sync` 自动维护回指及 MAP.md。
- 草稿不替换当前行为。effective 必须有生效版本/时间/证据；提交不等于上线。生效后主规格正文收敛为当前规则；部分下线只修改条款，全量下线标 retired 并注明替代入口。
- 一个条款有多个未生效修改时标出冲突/先后关系，不按日期自动覆盖。发现目标含糊时讨论，不编造约束。
- 更新对应索引，运行 `python3 scripts/project-workflow/workflow.py check`。开发状态与验证结果记 changelog，历史文件不作为当前契约。
- 实现核对由 project-spec-review 生成到专题 reviews；spec 开头只链接核对索引，不复制逐次报告或用报告覆盖当前要求。
