# 图片回复的运行边界

F-002 本地实现，部署及真实微信验收状态见 [交付记录](../../../changelog/2026-09.md)。完整行为契约归 [F-002](../../../specs/image-delivery/spec.md)，本页只说明连接关系。

```mermaid
flowchart LR
  Skill[Skill / bash 生成图片] --> Tool[Pi reply_image]
  Tool --> Exec[权限 acquire / 执行器二进制读取]
  Exec --> Art[ImageReplyService / 快照存储]
  Art --> Select[SQLite Task版本候选]
  Select --> Review[TaskManager / Review]
  Review --> Tx[completeTurn 事务]
  Tx --> Queue[Outbox: 文字和图片]
  Queue --> Delivery[DeliverReply]
  Delivery --> Upload[iLink prepareImage]
  Upload --> Ref[Outbox私有媒体引用]
  Ref --> Send[iLink sendPreparedImage]
```

- artifacts 提供图像元信息、完整解码、快照、额度和清理；业务侧不引用 sharp 或 iLink。
- 内部 read-binary 只在执行器与可信父进程之间传递数据，不注册模型可见的读取工具，Pi 响应只有图片元信息。
- TaskManager 清除执行器返回的自报附件列表，重新读取可信候选。只有 approved 结果携带发布 ID；SQLite 同事务复核版本/归属，过期结算同时抑制文字和图片。
- 原文本 chunks 接口保留，新增 imageIds；Outbox 的 artifact_id 为空即旧文字，上传引用不进入查询返回对象。
- DeliverReply 负责续租及 owner/attempt fencing，上传引用可复用，文字/图片依 part 顺序领取。Task 完成与网络投递结果分别显示。
- 生成文件、候选附件、上传引用、已送达记录是不同生命周期。启动清理在 workers 之前执行，不与活动 Run 并发删除图片；已提交投递不被后续 Task 取消自动撤回。
- Bootstrap 默认接入图片回复工具、Task 附件与 Outbox；截图复用项目 Skill 与现有权限执行链，没有增加浏览器或媒体服务。
