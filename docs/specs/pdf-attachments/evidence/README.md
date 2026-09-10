# PDF 验证证据

这些文件保留原测试日期、模型和验证范围；本轮仅迁移，未重新执行真实模型调用。以 [spec](../spec.md) 为当前契约。

- [原始输入与上传实测](codex-file-input-verification.md)
- [上传探针原始 JSON](codex-file-upload-probe.json)
- [网关合成 PDF 验证 JSON](gateway-verification.json)

上传探针、Base64 输入验证和项目网关 file_url 接入是不同实验，不互相替代。真实微信端到端和长期远端保留不由这些结果证明。scripts/verify-file-input.mjs 的输出已改到此目录。
