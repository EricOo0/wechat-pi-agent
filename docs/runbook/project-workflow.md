# 项目文档自动维护

适用：W-001，Python 3.10+、Git、已登录的 Codex CLI；不依赖 npm 或 Go。规则正文见 [规格](../specs/project-workflow/spec.md)。

## 安装与激活

在仓库执行 `python3 scripts/project-workflow/workflow.py install`，安装本地 Git hooksPath。脚本遇到已有 hooksPath 或原生 pre-commit 会明确停止，不覆盖；先检查并将项目 pre-commit 接入原有链路再安装。

项目 `.codex/config.toml` 开启 hooks，`.codex/hooks.json` 注册 UserPromptSubmit 与 Stop。新建或重新打开 Codex 会话，在 CLI `/hooks` 中信任这两个项目 Hook；项目目录可信不等于 Hook 定义已信任。不得手写 trusted_hash 或绕过审核。既有用户级 Hook 继续运行。

Skill 位于 `.agents/skills/`，新会话可发现；`$project-spec` 只手动调用，另两个在开发收尾可自动调用。与工程 `skills/` 中供微信助手使用的业务 Skill 分离。

## 日常使用

- 写规格：`$project-spec`，然后按该 Skill 维护目标专题。
- 生成地图与反向关系：`python3 scripts/project-workflow/workflow.py specs-sync`。
- 检查：`python3 scripts/project-workflow/workflow.py check`。
- 提交时先自动运行 `project-spec-review`，再运行 `project-change-sync`：只分析暂存树，每阶段最长 180 秒（总计最多约 6 分钟，另有终止收尾），使用现有 Codex 认证。未命中缓存时有两次模型调用。
- 核对完成会生成 spec 专题下的 reviews 报告、索引及 spec 入口；这些修改与普通文档一样需核对并暂存。纯排版等不涉及规格时不强制生成报告。
- 若 Hook 补写了文档，本次提交停止。核对并暂存这些文档后重新提交；不会自动 git add、commit、push。
- 收尾经验：当前 Agent 执行 project-learning-sync，可按需写 Runbook/Wiki。完成后 `python3 scripts/project-workflow/workflow.py learning-ack`；默认用 CODEX_THREAD_ID，无该变量时提供 `--session <当前session_id>`。

## 故障处理

| 症状 | 处理与成功信号 |
|---|---|
| 提交提示文档已更新 | 检查列出的文件、暂存后重试；显示已检查当前暂存版本即命中缓存 |
| 文档有未暂存修改 | 先整理暂存范围；脚本不会覆盖或悄悄加入其他工作 |
| codex exec 失败或超时 | 检查本机 Codex 登录/服务状态，重试；脚本不会输出原始认证日志，也不会因失败放行 |
| 规格回指或地图过期 | 执行 specs-sync，检查生成内容并暂存；它不会替你判定功能已上线 |
| 规格核对未通过 | 按提示读取 Git 私有目录中的 spec-review.md；补实现/验证或明确规格变更，不直接改报告放行 |
| 后置同步建议改写规格 | 在当前开发任务明确变更原因和接受依据，再修改 spec 并重新提交；Hook 不会自动修改要求消除偏差；仅允许根据前置就绪结论单独晋升 implemented |
| Hook 未执行 | 检查 git config --get core.hooksPath、Codex /hooks 的启用与信任状态；更改配置后重新打开会话 |
| 锁残留 | 用 git rev-parse --git-path project-workflow/commit.lock 定位，读取 PID 并确认进程已结束后只删除该锁，再重试；不要杀正常运行检查 |
| Stop 没有继续轮次 | 无新改动/非开发请求、已 ack、已兜底或未初始化会话均会跳过；可显式调用 learning Skill |

缓存和会话标记保存在 Git 私有目录 project-workflow，不进入提交，不保存用户 prompt 或会话 transcript。缓存绑定暂存树、HEAD 和规则内容；修改任何一项会重新分析。异常中断后重试前应核对可能已经写入的文档。

## 验证与边界

运行 `python3 -m unittest discover -s test/project-workflow -v`，在临时 Git 仓库验证暂存隔离、越界拒绝、重复提交、状态关系和 Stop 去重。测试使用替身，不消耗模型用量；真实 codex exec 冒烟另记 changelog。

只读快照不包含未暂存资料，因此初次安装应将要提交的 Skill、检查脚本和文档一并纳入暂存范围；不把全部工作区自动暂存。机器绝对路径和 node_modules 内部源码引用不作为便携性检查，历史材料保留其原始路径。

Git Hook 可被原生 --no-verify 绕过，不是安全边界。本轮未接入 CI；接入后使用同一个 check 命令。图像重绘、发布事实判断、外部副作用核对仍需实际证据，不由文档检查器保证。

参考：[Codex Hooks](https://learn.chatgpt.com/docs/hooks)、[Skills](https://learn.chatgpt.com/docs/build-skills)。

代码和本地验证完成后，在提交前同步 implemented；无需等 push。Hook 若补写状态/地图，核对并暂存后再提交。implemented 不等于 effective，部署/真实账号验收仍需明确证据。
