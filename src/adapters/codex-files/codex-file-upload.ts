import { createHash, randomUUID } from "node:crypto";
import type { UserFileRepository } from "../../modules/artifacts/index.js";
import type { FileStorage } from "../../modules/artifacts/index.js";
import type { AgentEvent } from "../../modules/observability/index.js";
import { FileInputError, type UserFile } from "../../modules/artifacts/index.js";

export interface CodexFileAuth { apiKey?: string }
interface Auth { token: string; accountId: string; scope: string }
interface Link { url: string; expires: number }
export class CodexFileUpload {
  private readonly links = new Map<string, Link>();
  private readonly pending = new Map<string, Promise<Link>>();
  public constructor(private readonly repository: UserFileRepository, private readonly storage: FileStorage,
    private readonly getAuth: () => Promise<CodexFileAuth | undefined>, private readonly fetchImpl: typeof fetch = fetch) {}

  public async prepare(file: UserFile, emit: (event: AgentEvent)=>void, signal?: AbortSignal): Promise<string> {
    const data = await this.storage.read(file); // Validate the authoritative original even on cache hits.
    const auth = await this.auth();
    const key = `${file.ownerId}:${file.id}:${file.sha256}:${auth.scope}`;
    const cached = this.links.get(key);
    if(cached && cached.expires>Date.now()+45_000) return cached.url;
    const running=this.pending.get(key);
    if(running) return (await running).url;
    const promise=this.obtain(file,data,auth,emit,signal);
    this.pending.set(key,promise);
    try { const link=await promise; this.links.set(key,link); return link.url; }
    finally { this.pending.delete(key); }
  }

  private async auth(): Promise<Auth> {
    const result=await this.getAuth();
    try {
      const token=result?.apiKey;
      if(!token)throw new Error("missing");
      const claims=JSON.parse(Buffer.from(token.split(".")[1]??"","base64url").toString()) as Record<string, unknown>;
      const accountId=(claims["https://api.openai.com/auth"] as Record<string,unknown>)?.chatgpt_account_id;
      if(typeof accountId!=="string"||!accountId)throw new Error("missing account");
      // Account identity is stable across OAuth refresh, and never crosses remote stores.
      return {token,accountId,scope:createHash("sha256").update(`codex:chatgpt.com:${accountId}`).digest("hex")};
    } catch { throw new FileInputError("FILE_AUTH_FAILED","文件上传需要有效的 Codex 登录，请重新登录后重试。"); }
  }

  private async obtain(file:UserFile,data:Buffer,auth:Auth,emit:(event:AgentEvent)=>void,external?:AbortSignal):Promise<Link> {
    const timeout=AbortSignal.timeout(90_000);const signal=external?AbortSignal.any([external,timeout]):timeout;
    const eventId=randomUUID();const started=Date.now();
    const record=(status:string,extra:Record<string,unknown>={})=>emit({type:"file_upload",at:new Date(),data:{eventId,fileId:file.id,name:file.name,status,...extra}});
    record("started");
    try {
      const prior=this.repository.getModelRef(file.id,auth.scope);
      if(prior) {
        try { const link=await this.finalize(prior.remoteId,auth,signal);record("succeeded",{reused:true,durationMs:Date.now()-started});return link; }
        catch(error){if(!(error instanceof FileInputError) || error.code!=="REMOTE_FILE_MISSING")throw error;this.repository.deleteModelRef(file.id,auth.scope);}
      }
      const metadata={file_name:file.name,file_size:data.length,use_case:"codex"};
      const created=await this.post("/files",metadata,auth,signal);
      const id=created.file_id;
      if(typeof id!=="string"||!/^file[_-][a-zA-Z0-9_-]+$/.test(id))throw new FileInputError("FILE_UPLOAD_FAILED","文件上传接口未返回有效文件标识。");
      const uploadUrl=this.safeUrl(created.upload_url);
      const response=await this.fetchImpl(uploadUrl,{method:"PUT",headers:{"Content-Type":"application/pdf","x-ms-blob-type":"BlockBlob","x-ms-client-request-id":randomUUID()},body:new Uint8Array(data),signal,redirect:"error"});
      if(!response.ok)throw new FileInputError("FILE_UPLOAD_FAILED",`文件上传失败（HTTP ${response.status}），原件已保留，请稍后重试。`);
      const body=created.pdf_c2pa_reservation?{pdf_c2pa_create_request:metadata}:{};
      const link=await this.finalize(id,auth,signal,body);
      this.repository.saveModelRef({fileId:file.id,scope:auth.scope,remoteId:id});
      record("succeeded",{reused:false,durationMs:Date.now()-started});return link;
    }catch(error){
      const safe=error instanceof FileInputError?error:new FileInputError("FILE_UPLOAD_FAILED",signal.aborted?"文件上传或链接获取超时/取消，原件已保留。":"文件上传或链接获取失败，原件已保留，请稍后重试。");
      record("failed",{errorCode:safe.code,durationMs:Date.now()-started});
      if(external?.aborted)throw new DOMException("Aborted","AbortError");
      throw safe;
    }
  }

  private async finalize(id:string,auth:Auth,signal:AbortSignal,body:Record<string,unknown>={}):Promise<Link> {
    for(let i=0;i<5;i++) {
      const result=await this.post(`/files/${encodeURIComponent(id)}/uploaded`,body,auth,signal);
      if(result.status==="success") {
        const url=this.safeUrl(result.download_url);
        const declared=Date.parse(url.searchParams.get("se")??"");
        const expires=Number.isFinite(declared)?declared:Date.now()+60_000;
        if(expires<=Date.now()+10_000)throw new FileInputError("REMOTE_FILE_MISSING","文件下载链接已失效，需重新上传。");
        return {url:url.href,expires};
      }
      if(result.status==="failed"||result.status==="error")throw new FileInputError("REMOTE_FILE_MISSING","远端文件已不可用，需重新上传。");
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},1000);const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(new Error("aborted"));};signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();});
    }
    throw new FileInputError("FILE_UPLOAD_PENDING","文件仍在远端处理中，请稍后重试。");
  }
  private safeUrl(value:unknown):URL {
    if(typeof value!=="string")throw new FileInputError("FILE_UPLOAD_FAILED","文件接口未返回有效链接。");
    let url:URL;try{url=new URL(value);}catch{throw new FileInputError("FILE_UPLOAD_FAILED","文件接口返回的链接无效。");}
    if(url.protocol!=="https:"||url.username||url.password||!(["oaiusercontent.com","blob.core.windows.net"].some(host=>url.hostname===host||url.hostname.endsWith(`.${host}`))))throw new FileInputError("FILE_UPLOAD_FAILED","文件接口返回的存储地址不受支持。");
    return url;
  }
  private async post(path:string,body:unknown,auth:Auth,signal:AbortSignal):Promise<Record<string,unknown>> {
    const res=await this.fetchImpl(`https://chatgpt.com/backend-api${path}`,{method:"POST",headers:{Authorization:`Bearer ${auth.token}`,"chatgpt-account-id":auth.accountId,"Content-Type":"application/json",originator:"pi"},body:JSON.stringify(body),signal,redirect:"error"});
    if(!res.ok){const code=res.status===404?"REMOTE_FILE_MISSING":res.status===401||res.status===403?"FILE_AUTH_FAILED":res.status===429?"FILE_RATE_LIMITED":"FILE_UPLOAD_FAILED";throw new FileInputError(code,`文件服务请求失败（HTTP ${res.status}），原件已保留，请稍后重试。`);}
    return await res.json() as Record<string,unknown>;
  }
}
