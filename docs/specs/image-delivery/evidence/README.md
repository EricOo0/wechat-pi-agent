# F-002 验证证据

- [本地完整检查输出](local-check.txt)：2026-09-10，49 个测试文件、188 项测试通过，架构/Lint/typecheck/build 通过。
- [代码、测试及依赖版本清单](source-sha256.json)：与本次检查对应的工作区 SHA-256。
- [逐条规格核对](../reviews/2026-09-10-local.md)。
- 实际浏览器 smoke：通过项目 Full Access executor，playwright-cli 唯一会话打开 about:blank、截图、关闭，exit 0；PNG 4254 字节，签名 89504e470d0a1a0a。截图环境子任务实际执行，输出为合成空白页面，已清理；没有私人桌面或真实微信上传。
- [官方上传协议版本](../../../vendor/ilink-image-upload/SOURCE.md)。

未验证：真实微信收到并打开图片、当前宿主屏幕录制授权、特定网页登录态、远端媒体 TTL/恰好一次、部署启用。完整检查不覆盖这些外部事实。

- [真实模型 Review 场景评估](review-evaluation.json)：gpt-5.6-sol，8 个合成场景全部符合预期；[场景](../../../../test/fixtures/task-review-cases.json) · [显式评估脚本](../../../../scripts/evaluate-task-review.ts)。
