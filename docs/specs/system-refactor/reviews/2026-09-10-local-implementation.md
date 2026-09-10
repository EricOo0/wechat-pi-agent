> 历史检查：对应含 Graph 的本地版本，当前已撤销该选型；最新验证见 evidence/README.md。

# R-001 本地实现核对

阶段：incremental。覆盖本地结构与自动化验证，不声明服务已上线或全部真实账号验收完成。规格入口：[R-001](../spec.md)。检查对象是当前未提交工作区；原始输出、基线和 SHA256 见 [证据](../evidence/local-check-2026-09-10.json)。

| 条款 | 结论 | 实现与证据 |
|---|---|---|
| R-001-01 | conforms | 原全局 use-cases 移除；模块经 index 导出，静态检查覆盖 core→adapter、跨模块私有导入、domain IO；Admin 依赖核心端口，CLI 启动交给 Bootstrap |
| R-001-02 | conforms | SQLite 原子领取排除同会话 RUNNING 项；Agent Runtime 拒绝重复运行；文件回执集成测试新增同会话重复领取拒绝断言，旧会话测试保留 |
| R-001-03 | conforms | Turn 真实使用 control/attachments/receipt/agent/complete 节点；Memory 使用 extract/merge/finish；简单管理查询保持应用方法 |
| R-001-04 | conforms | 拆分存储端口，保留原 SQLite 事务与 schema；原接收、执行完成、归档/记忆集成用例通过；业务已完成后检查点失败不重新发起 Agent |
| R-001-05 | conforms | DeliveryStore 与投递流程独立；ReplyPresentation 归 Messaging；原分段、投递失败重试与 Outbox 回归通过 |
| R-001-06 | conforms | 入库后可信权限处理保留；工具实时 acquire、撤销取消、授权 continuation 仍按原路径运行，权限/续跑/受管工具测试通过 |
| R-001-07 | conforms | 图片、PDF、本地原件、跨会话文件、file_list/file_use、纯上传回执和上下文重放测试通过；未扩展文件格式和供应商 |
| R-001-08 | conforms | Skill 来源排序与工具协议桥接分离；原 Skill/catalog/加载和真实 macOS 沙箱/Full Access 相关测试通过 |
| R-001-09 | conforms | 记忆业务提交与版本核对保留，Graph 不复制正文；快照、提炼/合并阶段重试与版本一致性测试通过 |
| R-001-10 | conforms | ProviderAuthService、AuthBackend、AuthOperationStore 分工；原模型切换、隔离凭证、drain/journal、Admin 保护和记忆模型绑定回归通过 |
| R-001-11 | conforms | Bootstrap lifecycle 拆出后台启停；原锁、端口、SIGTERM、30 秒收尾、会话归档、启动恢复测试通过 |
| R-001-12 | conforms | Admin/Trace 迁移与 Query 端口分离；Tree/Chat、模型调用与 reasoning、记忆任务、指标等原有测试通过 |
| R-001-13 | conforms | LangGraph/SQLite 引擎专项验证成功节点不重跑、数据库重开、版本拒绝、静态等待/同标识继续、取消和重复所有权；Pi 内部工具游标恢复明确不在范围内 |
| R-001-14 | unverified | 本地构建包含提示词及沙箱 worker，app.db/permissions.db 与主体/账号作用域保持，增加独立 workflow.db；尚未在真实用户运行环境执行升级、微信、OAuth/API Key、模型文件输入复验 |

结论：本地实现与自动化范围通过，发布与真实账号场景仍待独立验收。未修改规格以消除未验证项；R-001 保持 implementing/planned，Harness 后置。

迁移兼容重点：数据库内状态和外部 ID 保持；源码导入路径发生改变，外部自定义脚本若直接导入旧 src/dist 路径须按迁移映射更新。当前仓库内脚本已更新。Workflow 的节点闭包必须由调用方重建，通用 checkpoint 不能保证任意副作用恰好一次。
