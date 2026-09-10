# 实现与验证记录

日期：2026-09-08。本文记录模型与供应商管理实现及验证范围。

## 已实现

- 明确命令与同源帮助：/provider、/model（/models 列表别名）、/auth、-help/--help//help；未知语法原文交给 Agent。
- 用户级模型默认存储；/provider 先认证检查/列模型，再完整 provider+model 提交；没有隐式待选供应商。
- 本轮模型绑定、Pi setModel 保留历史；文件 router、实际模型 Trace、后台记忆任务使用固定选择。
- 本机 /admin/models 页面；Pi 注册供应商目录与模型列表；本地认证方式选择及异步进度。
- 候选认证在独立内存 store 中完成；目标 provider 排空活动任务后提交正式凭据；取消不提交；不确定提交隔离 provider 并依靠 journal 启动核对。
- 认证替换后旧失败任务绑定不能使用新账户自动重做；新任务在 gate 准入后绑定当前认证版本。
- 本机操作只允许 loopback、有效 Host/Origin 和页面令牌；不记录认证 secret/URL。
- 新增 migration 8；README 与 .env.example 已更新。本地 .env 已开启 MODEL_MANAGEMENT_ENABLED=true。

管理页 API 实际集中在 model-routes.ts：GET /admin/api/models、GET /admin/api/models/:provider、PUT /admin/api/selection；POST/GET /admin/api/auth、GET /admin/api/auth/:id、POST /admin/api/auth/:id/{begin,input,cancel}；GET /admin/api/events。统一令牌验证。

## 自动验证

- Lint、TypeScript typecheck、构建、git diff --check 通过。
- 新增及相关命令、认证、真实 Pi AgentSession 切换、Admin API、记忆运行回归共 17 项通过。
- 全量回归一次在本机负载升高时出现 11 个沙箱/停机超时（其余 109 项通过）；对应 11 项降低并发、使用单次30秒测试超时重新执行，全部通过。未改变生产超时或项目默认测试配置。
- 认证测试使用隔离临时凭证和测试 provider，覆盖成功提交前等待、取消、认证输入失效、提交中断恢复幂等。
- AgentSession 测试在首轮工具调用期间修改选择：当前两次模型调用均走旧 provider，下一轮才切换；历史和调用 Trace 匹配。
- 本机 Admin 测试覆盖缺失令牌、跨 Origin 拒绝，正常选择持久化和页面脚本有效性。

## 在线只读检查

用户重启服务后，/admin/models 与 /admin/api/models 均返回200。当前选择 openai-codex/gpt-5.6-terra；已注册40个provider，已配置认证为openai-codex。

Codex模型列表返回200：gpt-5.3-codex-spark、gpt-5.4、gpt-5.4-mini、gpt-5.5、gpt-5.6-luna、gpt-5.6-sol、gpt-5.6-terra。检查没有修改真实模型选择或登录账户。

## 尚未验收/限制

- 浏览器自动化预览两次超时，未完成视觉验收；页面脚本和真实HTTP接口已验证。
- 未代用户执行真实OAuth或API Key重新认证，不宣称所有provider实测通过。
- 使用共享宿主机Pi凭证，外部进程主动改账户不受本服务gate控制。
- Pi 0.84.3 的AuthStorage内部导入集中在staged-credential-store.ts，有专门桥接测试；升级依赖需回归。
- 用户启动服务后补充的极端提交等待绑定修复，需下一次正常启动加载；没有再次启停用户服务。
