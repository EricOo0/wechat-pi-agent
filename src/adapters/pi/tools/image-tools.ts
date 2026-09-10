import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ImageReplyError, type AuthorizedImageRead, type ImageArtifact, type ImageReplyContext, type ImageReplyService } from "../../../modules/artifacts/index.js";
export function createImageTools(service: ImageReplyService, context: () => Omit<ImageReplyContext, "toolCallId">, read: AuthorizedImageRead, select?: (image: ImageArtifact) => void, clear?: (context: Omit<ImageReplyContext, "toolCallId">) => void) {
  return [defineTool({
    name: "reply_image", label: "Attach reply image",
    description: "Attach a local PNG/JPEG to this task's reply. Resolve relative paths in your workspace. The system saves an immutable copy; at most 3 images per task revision. Use action=clear to discard selected images before replacing them. Images are queued only after task review approves the result. This tool does not mean the image was sent. Generate screenshots with existing skills or bash first.",
    parameters: Type.Object({path: Type.Optional(Type.String({minLength: 1})), action: Type.Optional(Type.Union([Type.Literal("append"),Type.Literal("clear")]))}),
    executionMode: "sequential",
    async execute(toolCallId, params, signal) {
      const current = {...context(), toolCallId};
      signal?.throwIfAborted();
      if (params.action === "clear") {
        if (params.path) throw new ImageReplyError("IMAGE_ARGUMENT", "清空图片时不要提供 path。");
        if (clear) clear(current); else service.repository.clear(current.ownerId,current.taskId,current.revision);
        return {content:[{type:"text" as const,text:JSON.stringify({selectedImages:[],delivered:false})}],details:{selectedImageIds:[] as string[]}};
      }
      if (!params.path) throw new ImageReplyError("IMAGE_ARGUMENT", "请提供图片 path。");
      const selected = service.selected(current.ownerId,current.taskId,current.revision);
      const replay = service.repository.getByToolCall(current.ownerId,current.turnId,toolCallId);
      if (selected.length >= 3 && !selected.some(item => item.id === replay?.id)) throw new ImageReplyError("IMAGE_LIMIT", "每次回复最多 3 张图片，请先清空再重新选择。");
      const image = await service.prepare(current, params.path, read, signal);
      signal?.throwIfAborted();
      if (select) select(image); else service.repository.select(image);
      return {content:[{type:"text" as const,text:JSON.stringify({artifactId:image.id,mimeType:image.mimeType,width:image.width,height:image.height,selectedForReply:true,delivered:false,note:"已保存图片并加入候选回复，审核通过后进入发送队列；尚未送达微信。"})}],details:{selectedImageIds:service.selected(current.ownerId,current.taskId,current.revision).map(item=>item.id)}};
    },
  })];
}
