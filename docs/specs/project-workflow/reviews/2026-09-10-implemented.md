# W-001-8 实现状态核对

范围：新增 implemented 状态及提交前受控晋升。核对当前未提交工作区，文件版本与运行结果见 [证据](../evidence/implemented-tests-2026-09-10.json)。

| 条款 | 结论 | 依据 |
|---|---|---|
| W-001-8：合法 implemented 状态 | conforms | 校验器接受 implemented，未要求 effective 发布证据；独立回归用例确认 effective 仍为 null |
| W-001-8：核对后、提交前更新 | conforms | 前置 schema 增加 implementation_ready；后置同步只允许 implementing→implemented，地图由脚本生成；报告记录就绪结论 |
| W-001-8：不夹带规格改写 | conforms | 比较完整元信息和正文，除 status 外必须一致；无就绪证据或正文变化测试均拒绝 |
| W-001-8：保留暂存检查机制 | conforms | 生成报告入口和地图后停止首次提交，暂存后缓存放行；原暂存隔离/偏差阻断等回归继续通过 |
| W-001-8：区分本地与外部验证 | conforms | verification_scope 为 local/external；local unverified 即使 ready=true 也拒绝晋升；外部待验收可保留，effective 声明仍须全部确认；三项专项回归通过 |

30 项隔离测试和 3 个修改后 Skill 校验通过；提交前真实核对曾发现验证范围缺口，已修复并补充回归，最终提交检查以对应暂存指纹报告为准。R-001 依据已推送的 e3e934f 和其本地验收记录调整为 implemented；部署与真实链路仍未确认。
