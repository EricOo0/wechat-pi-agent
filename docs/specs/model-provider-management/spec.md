---
{
  "id": "M-001",
  "title": "模型、供应商与认证管理",
  "kind": "feature",
  "maturity": "stable",
  "status": "accepted",
  "lifecycle": "active",
  "affects": [],
  "changes": [],
  "effective": null
}
---

> 实现核对：[版本化核对记录](reviews/README.md)

# M-001：模型、供应商与认证管理

本文件为该能力的现行规格入口，替代历史提案作为行为约束。迁入日期：2026-09-10；本次核对 README、命令与管理路由、模型类型和数据库迁移，未重新执行真实认证或全量回归。实现与历史验收见 [2026-09-08 记录](../../changelog/model-provider-management/2026-09-08.md)；[历史材料](history/README.md) 不作为当前接口清单。

## 1. 目标与范围

在微信和本机管理页查看供应商与模型、管理认证、保存用户默认模型，使新任务无需重启即可采用新选择。认证在运行服务的电脑上完成，微信不接收密钥。

当前复用 Pi 0.84.3 的模型目录、原生认证与调用机制。用户选择按可信 subjectKey 持久化，但凭证仍是本机共享 Pi 凭证；不提供多租户独立凭证库。自然语言切换、自动 fallback、多账户并行路由、自定义 provider 编辑器均不在范围内。

## 2. 命令契约

| 命令 | 行为 |
|---|---|
| -help / --help / /help | 总帮助，不要求模型认证 |
| /provider | 当前选择和已配置供应商 |
| /provider all [页码] | 注册供应商目录，包含未认证项 |
| /provider <供应商> [page <页码>] | 认证检查后列模型，不切换 |
| /provider <供应商> <模型ID> | 校验后原子保存完整选择 |
| /model、/models、/model page <页码> | 当前供应商模型目录 |
| /model <模型ID> | 在当前供应商内切换 |
| /auth [供应商] | 认证摘要和指引 |
| /auth <供应商> login / reauth | 创建首次认证或重新认证操作，在本机完成 |
| /provider -help、/model -help、/auth -help | 子命令帮助，兼容 --help |

只有完整合法语法进入管理逻辑；未知命令、参数数量不符、夹带解释性文字均原文交给 Agent。管理命令附带图片或文件时作为普通消息处理。合法命令内的不存在模型、认证失败等返回业务错误，旧选择不变。

## 3. 选择、绑定与会话

- ModelSelection 为 providerId、modelId、revision，不存在隐式待选供应商；相同选择重复提交保持幂等，提交检查预期版本。
- 用户持久选择优先；环境配置和 settings.json 仅用于无用户选择时的默认值。
- TurnModelBinding 包含选择与 credentialRevision；单轮模型调用、工具往返、文件适配和 Trace 使用同一绑定。
- 微信管理命令共用 Turn worker，长任务期间排队；本机管理页可保存后续选择。已经运行的 Turn 不被切换。
- 切换保留会话历史，后续请求可能将历史交给新供应商；不静默丢弃不兼容输入，不自动回退供应商。
- 同一旧 Turn 重做须遵守原绑定；新授权 continuation 是新 Turn。认证版本变化后旧失败任务不得自动换号重做。

## 4. 认证与提交

认证方式从 Pi Provider 读取，不假定所有供应商都支持 OAuth。本地凭证就绪不保证所有远端模型可访问；无可靠账号信息时不猜测邮箱。

候选凭证先保存在隔离内存中；失败或取消保留旧凭证。候选准备完成后停止目标 Provider 的新请求准入，等待聊天、记忆生成、文件调用完成，再更新正式凭证和认证版本。认证操作最多保留 10 分钟，重启后未完成登录需重发起。

认证和模型选择独立，更换账户不自动更换供应商或模型。凭证与 SQLite 无跨介质原子事务；提交记录支持启动核对，不确定提交隔离 Provider。共享凭证被外部进程修改不受本服务 gate 约束。Pi AuthStorage 内部依赖集中在 staged-credential-store.ts，升级必须回归。

模型文件引用按认证账号作用域隔离；本地原件保留。记忆任务固定模型与认证版本，不能在提炼/合并中途切换。实际调用模型用于 Trace，不能用当前默认选择回填历史。

## 5. 当前管理接口与数据

来源：[model-routes.ts](../../../src/entrypoints/admin-http/model-routes.ts)。以下是现行路径，历史提案中的 /admin/models/providers 等路径不适用。

| 方法与路径 | 用途 |
|---|---|
| GET /admin/models | 本机管理页 |
| GET /admin/api/models | 当前选择和供应商目录 |
| GET /admin/api/models/:provider | 供应商模型列表 |
| PUT /admin/api/selection | providerId/modelId/expectedRevision 提交选择 |
| POST /admin/api/auth | 创建 login/reauth 操作 |
| GET /admin/api/auth | 操作列表 |
| GET /admin/api/auth/:id | 操作状态 |
| POST /admin/api/auth/:id/begin | 选择认证方式并开始 |
| POST /admin/api/auth/:id/input | 提交该操作要求的本机输入 |
| POST /admin/api/auth/:id/cancel | 取消操作 |
| GET /admin/api/events | 脱敏管理审计 |

入口受 MODEL_MANAGEMENT_ENABLED 控制。管理路由校验 loopback、Host、Origin；API 要求页面控制令牌。认证响应 no-store，写入限制请求大小；日志、Trace、审计不保存密钥、token、OAuth 回调或签名 URL。

当前 migration 8 包含 user_model_settings、turn_model_bindings、provider_credential_revisions、provider_auth_operations、model_management_events；精确字段见 [migrations.ts](../../../src/adapters/sqlite/migrations.ts)。旧提案的拟新增表结构不替代实际 schema。

## 6. 验收与兼容约束

| ID | 验收条件 |
|---|---|
| M-001-1 | 精确命令和帮助匹配；未知/歧义/附带附件的消息保持普通 Agent 流程 |
| M-001-2 | auth-before-model；完整选择原子保存、版本冲突明确、幂等、重启保留 |
| M-001-3 | 首轮工具执行期间改变选择，当前轮仍用旧绑定，下一轮使用新绑定并保留历史 |
| M-001-4 | 认证取消/失败不覆盖旧凭证；成功提交先排空全部相关请求；不确定提交隔离 |
| M-001-5 | 账号变化后旧文件引用和旧失败任务不能自动使用新账号；记忆绑定一致 |
| M-001-6 | 本机 API 访问控制与脱敏有效；实际模型 Trace 可追溯 |

历史测试依据：model-switching、model-admin、provider-authentication、model-management 等测试及实现记录。真实 OAuth/API Key、所有 Provider 可用性与视觉验收不能由测试凭证或历史只读检查推断。

关闭管理开关后已有选择继续用于任务；回退保留理解当前迁移的版本，不直接用旧二进制读取不兼容 schema。[R-001](../system-refactor/spec.md) 负责目标目录与模块改造，本文件负责模型管理行为契约，不另维护第二套未来目录。

## 7. 未覆盖事项

真实账号认证及浏览器视觉验收按历史记录仍有缺口，本轮未复测。所有供应商兼容性、多租户凭证隔离、跨进程账户协调属于独立范围，不能在文档迁移时标记完成。
