# iLink 图片上传协议依据

- 来源：[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)
- 固定 commit：`7c04adc3e95775efd661ab9fba0626d86d237713`
- 核验日期：2026-09-10。
- 用途：支撑 [F-002 图片回复规格](../../specs/image-delivery/spec.md) 的 iLink 出站适配器。
- 许可证：上游 MIT；本目录仅保存协议核验结论及引用，未复制源文件；本地适配器独立实现，不引入新运行依赖。

## 选取源码与协议事实

1. [src/cdn/upload.ts](https://github.com/Tencent/openclaw-weixin/blob/7c04adc3e95775efd661ab9fba0626d86d237713/src/cdn/upload.ts)：计算明文 MD5、大小，生成 16 字节 key 和 filekey；图片上传请求 `media_type=1`、`no_need_thumb=true`、`aeskey=hex(key)`。无需单独上传缩略图。
2. [src/api/api.ts](https://github.com/Tencent/openclaw-weixin/blob/7c04adc3e95775efd661ab9fba0626d86d237713/src/api/api.ts)：认证 POST `ilink/bot/getuploadurl` 获取上传凭据。
3. [src/cdn/cdn-upload.ts](https://github.com/Tencent/openclaw-weixin/blob/7c04adc3e95775efd661ab9fba0626d86d237713/src/cdn/cdn-upload.ts)、[src/cdn/cdn-url.ts](https://github.com/Tencent/openclaw-weixin/blob/7c04adc3e95775efd661ab9fba0626d86d237713/src/cdn/cdn-url.ts)：优先 `upload_full_url`，否则 `{cdnBase}/upload?encrypted_query_param={encodeURIComponent(upload_param)}&filekey={filekey}`。CDN 使用 **POST**，Content-Type 为 application/octet-stream；不携带 bot Authorization。成功需 HTTP 200 及响应头 `x-encrypted-param`。
4. [src/cdn/aes-ecb.ts](https://github.com/Tencent/openclaw-weixin/blob/7c04adc3e95775efd661ab9fba0626d86d237713/src/cdn/aes-ecb.ts)：AES-128-ECB，默认 PKCS7 padding，密文大小为 `(floor(n / 16) + 1) * 16`，块对齐明文仍新增一个 padding 块。
5. [src/messaging/send.ts](https://github.com/Tencent/openclaw-weixin/blob/7c04adc3e95775efd661ab9fba0626d86d237713/src/messaging/send.ts)：IMAGE item=2，`media.encrypt_query_param` 使用 CDN 返回值；`media.aes_key` 是 **hex key 的 UTF-8 文本再 base64**，不是原始 16 字节 key 的 base64；`encrypt_type=1`；`mid_size` 为密文大小。

上游 README 中 PUT 和缩略图必需的概述与本 commit 代码不一致；本实现以实际发送代码为依据。代码未提供媒体有效期、过期错误码或服务端去重保证；本项目不据此声称 exactly-once，不自动假定媒体 TTL。

## 本项目边界与验证

- 提供 prepareImage / sendPreparedImage，允许 Outbox 私密保存媒体引用并复用；凭据变更时通过散列 scope 隔离。
- 本地额外约束 HTTPS 上传、禁止重定向、有限请求超时、外部取消，不持久化 CDN 错误正文。
- 不在 adapter 内嵌重试；重试由 Outbox 统一管理。
- 使用 mock fetch 核验加解密、尺寸、MD5、地址选择、消息结构、上传失败阻断、重试复用、取消；未向真实微信用户发送图片，线上协议兼容性仍需用户授权的真实验收。

## 可复现核验

```sh
git clone https://github.com/Tencent/openclaw-weixin.git /tmp/ilink-upstream-reference
git -C /tmp/ilink-upstream-reference checkout 7c04adc3e95775efd661ab9fba0626d86d237713
```

升级时重新比对以上五组文件；仅更新有明确事实支撑的字段与测试。
