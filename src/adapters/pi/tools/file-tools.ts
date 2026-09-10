import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { UserFileRepository } from "../../../modules/artifacts/index.js";
import { FileLibraryService } from "../../../modules/artifacts/index.js";
export function createFileTools(repository:UserFileRepository,ownerId:()=>string,select:(id:string,toolCallId:string)=>void) {
  const library = new FileLibraryService(repository);
  return [
    defineTool({name:"file_list",label:"Find user files",description:"List or search files saved by this user, across chat sessions. Query by filename. Returns up to 20 files; use offset for pagination. If several files match an ambiguous request, ask which one.",parameters:Type.Object({query:Type.Optional(Type.String({maxLength:255})),offset:Type.Optional(Type.Integer({minimum:0}))}),execute(_id,params){
      const result=library.list(ownerId(),params.query??"",params.offset??0);
      return Promise.resolve({content:[{type:"text" as const,text:JSON.stringify(result)}],details:{}});
    }}),
    defineTool({name:"file_use",label:"Attach user file",description:"Select a saved PDF for direct model reading in the next request and the rest of THIS turn. Only the file ID is recorded in history. Call again on a later turn when you need the original; a prior successful tool result does not mean the document is still attached. Does not itself analyze the file. At most 3 files per turn.",parameters:Type.Object({fileId:Type.String()}),execute(id,params){
      const file=library.requireReady(ownerId(),params.fileId);
      select(file.id,id);
      return Promise.resolve({content:[{type:"text" as const,text:JSON.stringify({file,selectedForCurrentTurn:true,note:"The original will be attached to the next model request. This is not an analysis result. Re-select on a later turn if the original is needed."})}],details:{fileId:file.id}});
    }}),
  ];
}
