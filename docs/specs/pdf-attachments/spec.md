---
{
  "id": "F-001",
  "title": "用户 PDF 文件库与模型文件输入",
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

# F-001：用户 PDF 文件库与模型文件输入

本文件是现行规格入口，迁入日期 2026-09-10。历史材料记录首版已实现、本地回归和合成 PDF 验证；真实微信端到端验收仍待完成。本轮为资料迁移，未重新运行模型验证。[历史材料](history/README.md) · [验证证据](evidence/README.md) · [状态记录](../../changelog/2026-09.md)。

## 1. 术语

用户文件：属于已鉴别用户、独立于 Session 保存的原件。远端引用：与模型服务及认证身份绑定的远端文件 ID。模型文件输入：在发送请求时使用的短期 file_url；不能把签名 URL 当作聊天历史。

## 2. 需求概述

微信接收 PDF，保存到用户文件库；用户在当前或新 Session 查询文件并要求分析，模型直接读取原件。首版使用当前 Codex 登录和模型，不增加 API Key 或 provider 能力配置，不做本地 PDF 解析。文字和图片保持原行为；暂不支持文件回传或其他厂商的文件上传。

## 3. 总体设计

微信文件引用 → 身份过滤并落库 → Turn 下载/保存 → 用户文件库 → Agent 查询/选择 fileId → Codex 上传或复用远端文件 → 获取短期下载 URL → Pi onPayload 注入 input_file.file_url → Pi 完成模型调用。

文件仅上传没有任务时回复保存结果。该应用直接处理的消息及回执在上传结束时立即通过 Agent.recordContext 写入会话，无需模型推理，并保存上下文快照。业务数据库保存持久事实，重启或压缩后缺失的最近 20 条记录在模型调用前兜底回放。文件上传不因没有调用模型而从对话上下文消失。跨 Session 查询属于用户的文件，不依赖旧会话上下文；多份候选让模型询问用户选择。

## 4. 当前实现边界

- `domain/files`：原件和远端引用类型。
- `application/interfaces`：UserFileRepository、FileStorage、ModelFileInput。
- `application/use-cases`：保存入站文件；按可信身份查询文件。
- `adapters/outbound/ilink`：FILE 元信息解析、受限 CDN 下载解密。
- `adapters/outbound/filesystem`：`data/files/<用户标识>/<fileId>/original.pdf`，文件 0600，目录 0700，文件名不参与路径拼接。
- `adapters/outbound/sqlite`：原件索引、下载引用与远端 file_id；与消息持久化关联。
- `adapters/outbound/pi/file-input/codex`：上传/取链接、Codex 文件请求转换。只有此层知道服务端上传协议。

文件凭据及下载签名不进入日志、Agent 历史或 Trace。Agent 查询只返回元信息，选择文件时以可信工具结果登记引用。每个模型请求发送前重新鉴权并准备引用，不扫描用户文字伪造的 fileId 标记。Pi 历史只保存 ID/元信息；需要原文时重新选择，避免压缩后必须依赖旧的 URL。错误通过工具或可读回执反馈，不静默丢附件、不假称分析成功。

## 5. 接口与数据

`InboundMessage.files?` 保存经过协议校验的引用；在 SenderPolicy 通过之后落库和下载。图片字段保留。

`user_files` 保存 id、owner、来源消息及 itemIndex、名称、MIME、字节数、哈希、原件路径、状态和错误；来源唯一键确保重放不会创建重复文件。`model_file_refs` 保存本地 ID、服务/认证作用域和远端 ID。远端链接可短期内存缓存；失效重新获取，文件不存在从本地原件重传。

Agent 提供用户文件查询和选择工具。选择结果是“已加入当前模型输入”，不等于模型分析完成。模型协议主要按 Pi `model.api` 路由，未知协议明确报错；不为每个模型建立能力矩阵。首版只实现已实测的 Codex Responses。

## 6. 可靠性、安全与可观测

PDF 下载有类型、字节数、超时和 CDN host 限制；单文件上限 20 MiB、每条最多 3 份、每轮最多选择 3 份、单用户原件额度 500 MiB。文件归属由可信消息身份推导，工具不能指定其他用户。控制面文件库保持对通用工具不可读。原件按哈希校验，原子 rename 后落库；失败重放可重试。

上传成功与模型可读取分开：当前实测直接 input_file.file_id 返回 404，file_url 可用。上传/刷新失败必须记录阶段；无原始 token、签名 URL 或 Base64。上传超时可能在远端产生孤立文件，不承诺远端恰好一次。

复用当前 Trace span 模型：文件保存、上传、引用事件与 toolCallId/文件 ID 关联；不调模型的文件回执也出现在列表。原件保存独立于 Trace 保留数量；/new 不删除文件。

## 7. 验证与回退

验证：模拟 iLink 加密下载与 SQLite 去重、跨用户隔离、跨 Session 查询、远端引用复用和失效重传、Pi onPayload 实际接线、不支持 provider 的错误回执、Trace span 与页面脚本、文字图片权限回归。Codex 上传链路用合成 PDF 做真实请求；微信真实 PDF 验收与本地测试分开报告。

回退：保持迁移兼容的版本，停用文件入口或回退文件业务；原件不删。当前 DB healthCheck 检查 migration 版本，不直接用旧二进制读取新迁移数据库。未解决的一般 Turn 崩溃恢复限制不宣称已修复，不借文件功能重构整个调度系统。

## 8. 历史验收清单（本轮未复测）

- [x] 用户级文件库和跨 Session 使用。
- [x] 远端上传 + file_url 由当前 Codex 实测支持。
- [x] Pi 使用 onPayload 扩展，无需手改 node_modules。
- [x] 实现及本地验证。
- [x] 使用项目实际接线做合成 PDF 模型验收。
- [ ] 真实微信文件端到端验收。

## 9. 错误与文案

不支持格式、文件过大、下载失败、文件不可用、当前通道未接入、上传失败、模型请求失败均明确告知用户。原件保存成功但分析失败时保留原件，用户无需重新上传。不得将认证或限流错误描述为不支持 PDF。

## 10. 证据

当前 Pi 0.84.3 用户/工具消息只有文字和图片，onPayload 在转换后、请求前调用。具体可见项目 node_modules 中的 types.d.ts、api/openai-codex-responses.js，以及项目 pi-agent-gateway.ts。

完整远端实测见 [codex-file-input-verification.md](evidence/codex-file-input-verification.md)。官方上传实现：https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/files.rs 。

## 11. 拆解与后续扩展

首版：文件收存 → 用户查询 → Codex 上传/刷新 → Pi 请求注入 → Trace/README/测试。其他厂商新增 `pi/file-input/<厂商>`；协议一致的字段转换可复用，上传存储和凭据仍隔离。大规模存储更换 FileStorage 实现，内容检索扩展 UserFileRepository，不影响模型输入层。


## 12. 验收契约与重构关系

| ID | 验收条件 |
|---|---|
| F-001-1 | PDF 通过可信用户身份归属，下载受限，重复消息不重复创建文件，原件跨 Session 保留 |
| F-001-2 | 文件类型、数量、大小与用户额度受限；跨用户查询/读取拒绝；路径与哈希校验有效 |
| F-001-3 | 纯上传只保存并返回回执，无模型调用；立即更新上下文，补录重放去重且不引入未来消息 |
| F-001-4 | file_list 查询、file_use 仅选择本 Turn 的原件；历史不依赖旧签名 URL |
| F-001-5 | Codex 远端引用按账号隔离，短期 URL 仅内存缓存；失效取新链接或从原件重传 |
| F-001-6 | 不支持通道、上传或模型失败明确反馈，保留原件；凭证/签名/二进制不进入普通 Trace |
| F-001-7 | 文字、图片、权限、会话和模型管理原行为不回归；真实微信与合成模型验证分别报告 |

当前只支持 PDF 原始文件输入，微信回复仍为文本；不提供文件删除/回传或远端清理能力。历史 Base64 探针不表示生产实现采用 Base64，生产接入使用上传后的 file_url。原始探针、上传验证和网关验证的范围各自独立。

[R-001](../system-refactor/spec.md) 定义 artifacts/context/models 和协议适配的目标归属；上文当前路径只用于理解既有实现，不要求重构继续使用 use-cases 目录。扩展其他格式/供应商另行确定规格。
