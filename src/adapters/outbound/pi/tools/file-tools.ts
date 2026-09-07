import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { UserFileRepository } from "../../../../application/interfaces/user-file-repository.js";
import { FileInputError, fileSummary } from "../../../../domain/files/user-file.js";
export function createFileTools(repository:UserFileRepository,ownerId:()=>string,select:(id:string,toolCallId:string)=>void) {
  return [
    defineTool({name:"file_list",label:"Find user files",description:"List or search files saved by this user, across chat sessions. Query by filename. Returns up to 20 files; use offset for pagination. If several files match an ambiguous request, ask which one.",parameters:Type.Object({query:Type.Optional(Type.String({maxLength:255})),offset:Type.Optional(Type.Integer({minimum:0}))}),execute(_id,params){
      const files=repository.list(ownerId(),params.query??"",params.offset??0).map(fileSummary);
      return Promise.resolve({content:[{type:"text" as const,text:JSON.stringify({files,nextOffset:files.length===20?(params.offset??0)+20:null})}],details:{}});
    }}),
    defineTool({name:"file_use",label:"Attach user file",description:"Select a saved PDF for direct model reading in the next request and the rest of THIS turn. Only the file ID is recorded in history. Call again on a later turn when you need the original; a prior successful tool result does not mean the document is still attached. Does not itself analyze the file. At most 3 files per turn.",parameters:Type.Object({fileId:Type.String()}),execute(id,params){
      const file=repository.get(ownerId(),params.fileId);
      if(!file||file.status!=="ready")throw new FileInputError("FILE_NOT_FOUND","找不到可用文件，请查询文件库或重新发送。");
      select(file.id,id);
      return Promise.resolve({content:[{type:"text" as const,text:JSON.stringify({file:fileSummary(file),selectedForCurrentTurn:true,note:"The original will be attached to the next model request. This is not an analysis result. Re-select on a later turn if the original is needed."})}],details:{fileId:file.id}});
    }}),
  ];
}
