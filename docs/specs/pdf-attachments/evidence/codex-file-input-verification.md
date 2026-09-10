# Codex Responses 原始 PDF 输入实测

日期：2026-09-07。测试使用当前项目保存的模型选择及 Pi OAuth 登录；未发送真实用户文件，未记录访问令牌或账号 ID。

## 请求与结果

Endpoint：`POST https://chatgpt.com/backend-api/codex/responses`
Model：`gpt-5.6-terra`
通用参数：`store=false`、`stream=true`、`reasoning.effort=low`。

1. 文字对照：要求只回复 OK。HTTP 200，回复 `OK`。
2. PDF：内存构造单页有效 PDF，页面内含随机标记 `PDFCHECK_712515d54419`。通过 `input_file` 的 `filename` 和 `file_data=data:application/pdf;base64,...` 发送；用户请求只要求返回页面文字，没有包含随机标记。HTTP 200，回复 `PDFCHECK_712515d54419`，精确匹配。

```json
{
  "role": "user",
  "content": [
    {
      "type": "input_file",
      "filename": "synthetic-probe.pdf",
      "file_data": "data:application/pdf;base64,<PDF bytes>"
    },
    { "type": "input_text", "text": "Return only the exact text printed on the PDF page." }
  ]
}
```

## 可确认范围

当前账号、模型及 Codex Responses HTTP/SSE 通道能够接收 Base64 原始 PDF 并用于模型回答。测试通过原生 HTTP 请求绕过 Pi 文本/图片类型限制，但使用同一服务入口和已有登录凭据。没有修改项目模型调用代码，也没有创建远端 Files API 资源。

尚未验证：多页/扫描件/中文复杂版面、大文件上限、其他文件格式、file_id/Files 上传端点、其他模型、WebSocket 通道，以及 Pi 多轮重放/压缩时的文件内容处理。不得将单次成功解释为所有这些行为已支持。

设计影响：首选用户文件库存储，按需将原 PDF 和用户请求送入当前 Codex Responses 通道。下一步需实现 Pi 文件内容适配及多轮历史/压缩策略，无需仅因认证问题引入另一套 OpenAI API Key。设计正文与结构化稿仍需围绕该实测结论统一修订。

## 补充验证：先上传，再提问（2026-09-07）

实测结果：**上传成功后，可使用签名下载 URL 作为 `input_file.file_url` 提问；直接使用返回的 `file_id` 未成功。**

参考官方 Codex 上传实现：
https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/files.rs
该接口在官方源码中用于 Apps/MCP 文件参数，本次额外验证其返回链接用于模型输入。

| 阶段 | 结果 |
|---|---|
| POST /backend-api/files，use_case=codex | HTTP 200，返回 file_id 与签名 upload_url |
| PUT upload_url，上传合成 PDF 原始字节 | HTTP 201 |
| POST /backend-api/files/{file_id}/uploaded | HTTP 200，status=success，返回 download_url |
| Codex Responses 使用 input_file.file_id | HTTP 404，Files [...] were not found |
| 稍后重试相同 file_id | 仍为 HTTP 404 |
| Codex Responses 使用 input_file.file_url=download_url | HTTP 200，response.completed，准确读出 PDF 中随机标记 |
| 同一个 download_url，连续两次独立请求 | 均 HTTP 200，均准确读出标记；不携带 previous_response_id 或会话历史 |

合成 PDF 只包含 `UPLOADCHECK_fe5de87c3c5d`。提问没有携带标记文本或文件 Base64。使用当前 `gpt-5.6-terra` 和现有 Pi Codex OAuth，没有另配 API Key。此测试创建了一份无敏感数据的远端 PDF，未验证删除接口。

本次下载链接包含签名和有效期字段，样本 expiresAt 为 2026-09-07T04:41:10Z，在约 04:36 UTC 获取，因此不能把 URL 当作永久引用。已验证重复调用 uploaded 可以取到可用链接；没有等待链接到期，尚未验证过期后的刷新及长期文件存储期限。

设计落点：本地 fileId 是持久标识；远端缓存保存 backend file_id 和短期签名 URL/过期时间。请求模型时使用 file_url；过期前向 backend 获取新链接，若文件失效再从本地原件重传。刷新失败、重传和远端删除流程需要实施验收，不能依据本次短时成功承诺长期复用。签名 URL 属于凭据，不进入普通日志、Trace 或模型可见的文字提示；只放入传输字段。

结构化结果：`codex-file-upload-probe.json`（无令牌和签名 URL）。
