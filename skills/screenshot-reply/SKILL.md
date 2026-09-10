---
name: screenshot-reply
description: 截取网页或 macOS 桌面并通过微信回复图片；复用 bash、playwright-cli、screencapture 和 reply_image。
---

# 截图并回复图片

图片保存在当前工作目录，例如 `output/screenshot.png`，不要保存在 `$TMPDIR`：每次 bash 结束会清理临时目录及后台进程。生成成功后调用 `reply_image(path)`；该工具保存快照并登记候选附件，任务审核和 Outbox 后续完成投递。工具登记成功不代表微信已经送达。

## 网页

使用已有 `playwright-cli`。浏览器启动、导航、截图和关闭必须在**同一次 bash 调用**内完成，使用唯一且简短的会话名，不接管已有浏览器、不执行 `kill-all`。不要覆盖执行器提供的短 `$TMPDIR`。

下面是可以按用户目标调整的例子；网页地址作为引号包裹的参数传入，不拼接不可信 shell 代码：

```bash
set -e
mkdir -p output
session="shot-$$"
trap 'playwright-cli -s="$session" close >/dev/null 2>&1 || true' EXIT
playwright-cli -s="$session" open 'https://example.com/'
playwright-cli -s="$session" screenshot --filename=output/screenshot.png
test -s output/screenshot.png
```

如需登录、导航或等待页面元素，在同一次调用中加入相应 Playwright 命令。独立会话不会自动继承用户浏览器登录态。缺少 CLI、浏览器或所需权限时如实报告，不自动安装软件、关闭用户会话或扩大权限。受限执行模式保留现有网络及 Unix socket 限制；短临时目录不会自动授予浏览器所需权限。

## 桌面

macOS 使用现有系统命令（实际采集桌面须在用户请求范围内）：

```bash
set -e
mkdir -p output
screencapture -x output/desktop-screenshot.png
test -s output/desktop-screenshot.png
```

若出现 `could not create image from display`，报告采集失败。检查实际服务启动进程对应的屏幕录制授权及桌面会话；应用内 Full Access 不等于 macOS 屏幕录制授权，不能只凭该错误断言唯一原因。

## 回复

截图命令成功后调用 `reply_image` 并传入实际输出路径。用户已经要求发送截图时，直接登记图片回复即可。已有图片、图表也使用同一工具，无需重新截图。失败时保留具体执行错误，不声称已生成或已发送图片。
