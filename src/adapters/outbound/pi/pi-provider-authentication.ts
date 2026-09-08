import { createHash, randomUUID } from "node:crypto";
import { InMemoryCredentialStore, type AuthEvent, type AuthPrompt, type Credential, type CredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderAuthentication, AuthOperationSummary } from "../../../application/interfaces/provider-authentication.js";
import { ModelManagementError } from "../../../domain/models/model-selection.js";
import type { SqliteModelSelectionRepository } from "../sqlite/sqlite-model-selection-repository.js";
import type { ProviderRequestGate } from "./provider-request-gate.js";
export interface LocalAuthOperation extends AuthOperationSummary { events: AuthEvent[]; prompt?: AuthPrompt; promptId?: string; methods: string[] }
interface PendingOperation { view: LocalAuthOperation; controller: AbortController; timer: ReturnType<typeof setTimeout>; answer?: { id: string; resolve(value: string): void; reject(error: Error): void }; running?: Promise<void> }
export class PiProviderAuthentication implements ProviderAuthentication {
  private readonly operations = new Map<string, PendingOperation>();
  public constructor(private readonly runtime: ModelRuntime, private readonly credentials: CredentialStore,
    private readonly repository: SqliteModelSelectionRepository, private readonly gate: ProviderRequestGate) {}
  public async recover(): Promise<void> {
    const rows = this.repository.db.prepare("SELECT * FROM provider_auth_operations WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED','EXPIRED')").all();
    for (const row of rows) {
      const provider = String(row.provider_id);
      const credential = await this.credentials.read(provider);
      const committed = row.status === "COMMITTING" && credential && fingerprint(credential) === row.candidate_hash;
      if (committed) this.finishCommit(String(row.id), provider);
      else this.repository.db.prepare("UPDATE provider_auth_operations SET status='FAILED',error='认证操作被重启中断，请重新发起。',updated_at=? WHERE id=?").run(new Date().toISOString(), String(row.id));
    }
    if (rows.length) await this.runtime.refresh({ allowNetwork: false });
  }
  public async start(provider: string, action: "login" | "reauth"): Promise<AuthOperationSummary> {
    const p = this.runtime.getProvider(provider);
    if (!p) throw new ModelManagementError("PROVIDER_NOT_FOUND", "供应商不存在。");
    if (action === "login" && ((await this.credentials.read(provider)) || this.runtime.hasConfiguredAuth(provider))) throw new ModelManagementError("AUTH_EXISTS", `已有认证配置，更换账户请使用 /auth ${provider} reauth。`);
    const methods = [...(p.auth.oauth?.login ? ["oauth"] : []), ...(p.auth.apiKey?.login ? ["api_key"] : [])];
    if (!methods.length) throw new ModelManagementError("AUTH_AMBIENT", "该供应商需要通过本机环境配置认证，没有交互登录入口。");
    for (const op of this.operations.values()) if (op.view.providerId === provider && !terminal(op.view.status)) return Promise.resolve({ id: op.view.id, providerId: provider, status: op.view.status });
    const id = randomUUID(); const now = new Date().toISOString();
    this.repository.db.prepare("INSERT INTO provider_auth_operations(id,provider_id,status,created_at,updated_at) VALUES(?,?,'WAITING_LOCAL',?,?)").run(id, provider, now, now);
    const controller = new AbortController();
    const timer = setTimeout(() => this.cancel(id, "EXPIRED"), 10 * 60_000); timer.unref();
    this.operations.set(id, { view: { id, providerId: provider, status: "WAITING_LOCAL", methods, events: [] }, controller, timer });
    this.repository.audit("provider_auth_operation", { id, providerId: provider, status: "WAITING_LOCAL" });
    return Promise.resolve({ id, providerId: provider, status: "WAITING_LOCAL" });
  }
  public list(): AuthOperationSummary[] { return this.repository.db.prepare("SELECT id,provider_id,status,error FROM provider_auth_operations ORDER BY created_at DESC LIMIT 30").all().map((r) => ({ id: String(r.id), providerId: String(r.provider_id), status: String(r.status), ...(r.error ? { error: String(r.error) } : {}) })); }
  public get(id: string): LocalAuthOperation | undefined { const op = this.operations.get(id); if (op) return op.view; const prior = this.list().find((r) => r.id === id); return prior ? { ...prior, methods: [], events: [] } : undefined; }
  public begin(id: string, method: string): void {
    const op = this.required(id);
    if (op.view.status !== "WAITING_LOCAL" || op.running) throw new ModelManagementError("AUTH_STATE", "认证操作已经开始或结束。");
    if (!op.view.methods.includes(method)) throw new ModelManagementError("AUTH_METHOD", "请选择该供应商支持的认证方式。");
    this.setStatus(op, "AUTHENTICATING");
    op.running = this.login(op, method as "oauth" | "api_key");
  }
  public submit(id: string, promptId: string, value: string): void {
    const op = this.required(id);
    if (!op.answer || op.answer.id !== promptId || op.controller.signal.aborted) throw new ModelManagementError("AUTH_PROMPT_EXPIRED", "此认证输入已过期，请刷新操作。");
    if (value.length > 16_384) throw new ModelManagementError("AUTH_INPUT_SIZE", "认证输入过长。");
    const prompt = op.view.prompt;
    if (prompt?.type === "select" && !prompt.options.some((v) => v.id === value)) throw new ModelManagementError("AUTH_INPUT", "请选择列出的选项。");
    const answer = op.answer; delete op.answer; delete op.view.prompt; delete op.view.promptId; answer.resolve(value);
  }
  public cancel(id: string, status = "CANCELLED"): void {
    const op = this.operations.get(id); if (!op || terminal(op.view.status) || op.view.status === "COMMITTING") return;
    op.controller.abort(); op.answer?.reject(new DOMException("Aborted", "AbortError")); delete op.answer;
    this.setStatus(op, status); this.clearInteraction(op);
  }
  public async close(): Promise<void> { for (const id of this.operations.keys()) this.cancel(id); await Promise.allSettled([...this.operations.values()].flatMap((o) => o.running ? [o.running] : [])); }
  private async login(op: PendingOperation, method: "oauth" | "api_key"): Promise<void> {
    try {
      const staging = new InMemoryCredentialStore();
      const stagedRuntime = await ModelRuntime.create({ credentials: staging, allowModelNetwork: false, refreshOnCreate: false });
      const provider = this.runtime.getProvider(op.view.providerId)!;
      stagedRuntime.registerNativeProvider(provider);
      const credential = await stagedRuntime.login(provider.id, method, {
        signal: op.controller.signal,
        notify: (event) => { if (!op.controller.signal.aborted) { op.view.events.push(event); if (op.view.events.length > 10) op.view.events.shift(); } },
        prompt: (prompt) => this.prompt(op, prompt),
      });
      op.controller.signal.throwIfAborted();
      this.setStatus(op, "WAITING_IDLE"); this.clearInteraction(op, false);
      await this.gate.exclusive(provider.id, async () => {
        op.controller.signal.throwIfAborted();
        // Journal before touching the real store; candidate bytes never enter SQLite.
        this.repository.db.prepare("UPDATE provider_auth_operations SET status='COMMITTING',candidate_hash=?,updated_at=? WHERE id=?").run(fingerprint(credential), new Date().toISOString(), op.view.id);
        op.view.status = "COMMITTING";
        await this.credentials.modify(provider.id, () => Promise.resolve(credential));
        // Account revision must commit even if runtime refresh fails; old bindings must not reuse new credentials.
        this.finishCommit(op.view.id, provider.id);
        await this.runtime.refresh({ providers: [provider.id], allowNetwork: false });
        op.view.status = "SUCCEEDED";
      }, op.controller.signal);
    } catch {
      if (!op.controller.signal.aborted) {
        if (op.view.status === "COMMITTING") {
          this.gate.quarantine(op.view.providerId);
          // Do not overwrite the recovery journal or claim the old account survived an uncertain commit.
          op.view.error = "账户提交结果需恢复核对，请重启服务后查看状态。";
        } else { op.view.error = "认证未完成，旧账户保持不变。请重试或检查本机认证配置。"; this.setStatus(op, "FAILED"); }
      }
    } finally { this.clearInteraction(op); }
  }
  private prompt(op: PendingOperation, prompt: AuthPrompt): Promise<string> {
    if (op.answer) return Promise.reject(new Error("Concurrent auth input is not supported"));
    const promptId = randomUUID();
    // AbortSignal is not serializable and is never returned to the browser.
    const { signal: promptSignal, ...publicPrompt } = prompt;
    op.view.prompt = publicPrompt; op.view.promptId = promptId;
    return new Promise((resolve, reject) => {
      const signal = promptSignal ? AbortSignal.any([promptSignal, op.controller.signal]) : op.controller.signal;
      const clear = () => { signal.removeEventListener("abort", abort); if (op.answer?.id === promptId) { delete op.answer; delete op.view.prompt; delete op.view.promptId; } };
      const abort = () => { clear(); reject(new DOMException("Aborted", "AbortError")); };
      op.answer = { id: promptId, resolve: (value) => { clear(); resolve(value); }, reject: (error) => { clear(); reject(error); } };
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    });
  }
  private finishCommit(id: string, provider: string): void {
    this.repository.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.repository.db.prepare("SELECT status FROM provider_auth_operations WHERE id=?").get(id);
      if (row?.status !== "SUCCEEDED") {
        this.repository.db.prepare("INSERT INTO provider_credential_revisions VALUES(?,1) ON CONFLICT(provider_id) DO UPDATE SET revision=revision+1").run(provider);
        this.repository.db.prepare("UPDATE provider_auth_operations SET status='SUCCEEDED',candidate_hash=NULL,error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      }
      this.repository.db.exec("COMMIT");
    } catch (error) { this.repository.db.exec("ROLLBACK"); throw error; }
    this.repository.audit("provider_auth_operation", { id, providerId: provider, status: "SUCCEEDED" });
  }
  private required(id: string): PendingOperation { const op = this.operations.get(id); if (!op) throw new ModelManagementError("AUTH_NOT_FOUND", "认证操作不存在或已过期。"); return op; }
  private setStatus(op: PendingOperation, status: string): void { op.view.status = status; this.repository.db.prepare("UPDATE provider_auth_operations SET status=?,error=?,updated_at=? WHERE id=?").run(status, op.view.error ?? null, new Date().toISOString(), op.view.id); this.repository.audit("provider_auth_operation", { id: op.view.id, providerId: op.view.providerId, status }); }
  private clearInteraction(op: PendingOperation, stopTimer = true): void { delete op.view.prompt; delete op.view.promptId; op.view.events = []; if (stopTimer) clearTimeout(op.timer); }
}
function fingerprint(credential: Credential): string { return createHash("sha256").update(JSON.stringify(credential)).digest("hex"); }
function terminal(status: string): boolean { return ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(status); }
