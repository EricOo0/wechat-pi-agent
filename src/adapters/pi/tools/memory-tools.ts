import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { UserMemoryService } from "../../../modules/memory/index.js";
export function createMemoryTools(memory: UserMemoryService, owner: () => string) {
  return [
    defineTool({name:'memory_search',label:'Search user memory',description:'Search this user’s memory by literal keywords, across sessions. Returns matching memory IDs, line numbers and snippets. For Chinese, try short concrete keywords. Read relevant hits before relying on historical details.',parameters:Type.Object({query:Type.String({minLength:1,maxLength:200}),limit:Type.Optional(Type.Integer({minimum:1,maximum:50}))}),execute(_id,params){
      return Promise.resolve({content:[{type:'text' as const,text:JSON.stringify(memory.search(owner(),params.query,params.limit??20))}],details:{}});
    }}),
    defineTool({name:'memory_read',label:'Read user memory',description:'Read a memory ID returned by memory_search, or MEMORY.md. Paths are confined to the current user’s memory directory. Line numbers are 1-based.',parameters:Type.Object({memoryId:Type.String(),startLine:Type.Optional(Type.Integer({minimum:1})),lineCount:Type.Optional(Type.Integer({minimum:1,maximum:200}))}),execute(_id,params){
      return Promise.resolve({content:[{type:'text' as const,text:JSON.stringify(memory.read(owner(),params.memoryId,params.startLine??1,params.lineCount??100))}],details:{}});
    }}),
  ];
}
