import type { ModelFileInput, ModelFileRequest } from "../ports/model-file-input.js";
import { FileInputError } from "../domain/user-file.js";
export class ModelFileInputRouter implements ModelFileInput {
  public constructor(private readonly codex:ModelFileInput) {}
  public assertSupported(model:{api:string;provider:string;baseUrl:string}):void {
    if(model.api!=="openai-codex-responses"||model.provider!=="openai-codex"||!/^https:\/\/chatgpt\.com\/backend-api(?:\/codex(?:\/responses)?)?\/?$/.test(model.baseUrl))throw new FileInputError("FILE_INPUT_UNSUPPORTED","文件已保存，但当前模型通道尚未接入文件输入。可以切换到 Codex 通道后重试。");
  }
  public async apply(payload:unknown,model:{api:string;provider:string;id:string;baseUrl:string},request:ModelFileRequest):Promise<unknown>{
    if(!request.fileIds.length)return payload;this.assertSupported(model);return this.codex.apply(payload,model,request);
  }
}
