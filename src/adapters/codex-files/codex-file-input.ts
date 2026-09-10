import type { ModelFileInput, ModelFileRequest } from "../../modules/artifacts/index.js";
import type { UserFileRepository } from "../../modules/artifacts/index.js";
import { FileInputError } from "../../modules/artifacts/index.js";
import type { CodexFileUpload } from "./codex-file-upload.js";
export class CodexFileInput implements ModelFileInput {
  public constructor(private readonly repository: UserFileRepository, private readonly uploads: CodexFileUpload) {}
  public async apply(payload:unknown, _model:unknown, request:ModelFileRequest):Promise<unknown> {
    if(!request.fileIds.length)return payload;
    const body=payload as {input?:unknown[]};
    if(!body||!Array.isArray(body.input))throw new FileInputError("FILE_INPUT_INVALID","当前模型请求无法附加文件。");
    const content:unknown[]=[];
    for(const id of new Set(request.fileIds)) {
      const file=this.repository.get(request.ownerId,id);
      if(!file||file.status!=="ready")throw new FileInputError("FILE_NOT_FOUND","找不到可用文件，请查询文件库或重新发送。");
      const url=await this.uploads.prepare(file,request.emit,request.signal);
      content.push({type:"input_text",text:`User-selected document: ${JSON.stringify({fileId:id,filename:file.name})}`},{type:"input_file",file_url:url});
    }
    request.emit({type:"file_input",at:new Date(),data:{fileIds:[...request.fileIds],status:"succeeded",transport:"file_url"}});
    // Transport-only addition: neither signed URLs nor bytes enter Agent/Pi history.
    return {...body,input:[...body.input,{role:"user",content}]};
  }
}
