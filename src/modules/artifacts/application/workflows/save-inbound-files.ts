import { createHash } from "node:crypto";
import type { UserFileRepository } from "../../ports/user-file-repository.js";
import type { FileStorage } from "../../ports/file-storage.js";
import type { InboundMessage } from "../../../messaging/index.js";
import type { AgentEvent } from "../../../observability/index.js";
import { FileInputError, MAX_FILES_PER_MESSAGE, fileSummary, type InboundFileReference, type UserFile } from "../../domain/user-file.js";
export class SaveInboundFiles {
  public constructor(private readonly repository: UserFileRepository, private readonly storage: FileStorage,
    private readonly downloader: { download(file: InboundFileReference, signal?: AbortSignal): Promise<Buffer> }) {}
  public async execute(ownerId: string, message: InboundMessage, emit: (event: AgentEvent)=>void, signal?: AbortSignal): Promise<{ files: UserFile[]; receipt: string }> {
    const files: UserFile[]=[];const lines: string[]=[];
    for(const [index,ref] of (message.files??[]).entries()) {
      const id="fil_"+createHash("sha256").update(JSON.stringify([ownerId,message.channelMessageId,ref.itemIndex])).digest("hex").slice(0,32);
      const existing=this.repository.get(ownerId,id);
      if(existing?.status==="ready") {files.push(existing);lines.push(`已保存：${existing.name}（${id}）`);continue;}
      const file:UserFile={id,ownerId,messageId:message.channelMessageId,itemIndex:ref.itemIndex,name:ref.name,status:"failed",bytes:0,sha256:"",mimeType:ref.name.toLowerCase().endsWith(".pdf")?"application/pdf":"application/octet-stream",createdAt:existing?.createdAt??new Date().toISOString()};
      const started=Date.now();emit({type:"file_save",at:new Date(),data:{fileId:id,name:ref.name,status:"started"}});
      try {
        if(index>=MAX_FILES_PER_MESSAGE)throw new FileInputError("FILE_COUNT_LIMIT","每条消息最多保存 3 个文件，请分开发送。");
        const data=await this.downloader.download(ref,signal);
        if(this.repository.usedBytes(ownerId)+data.length>500*1024*1024)throw new FileInputError("FILE_QUOTA_EXCEEDED","文件库超过 500 MiB 存储额度，请清理后重试。");
        await this.storage.save(ownerId,id,data);
        Object.assign(file,{status:"ready",bytes:data.length,sha256:createHash("sha256").update(data).digest("hex")});
        lines.push(`已保存：${file.name}（${id}）`);
      }catch(error){if(signal?.aborted)throw error;file.errorCode=error instanceof FileInputError?error.code:"FILE_SAVE_FAILED";lines.push(`${ref.name}：${error instanceof FileInputError?error.message:"文件保存失败，请稍后重试。"}`);}
      this.repository.save(file);files.push(file);emit({type:"file_save",at:new Date(),data:{...fileSummary(file),fileId:id,status:file.status==="ready"?"succeeded":"failed",durationMs:Date.now()-started}});
    }
    return {files,receipt:lines.join("\n")+(files.some(f=>f.status==="ready")?"\n可以告诉我希望如何分析；换新会话后也能查询这些文件。":"")};
  }
}
