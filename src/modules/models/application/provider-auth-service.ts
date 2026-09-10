import { randomUUID } from "node:crypto";
import type { AuthBackend, AuthOperationStore, AuthPrompt, AuthEvent } from "../ports/auth-backend.js";
import type { ProviderAuthentication, AuthOperationSummary } from "../ports/provider-authentication.js";
import { ModelManagementError } from "../domain/model-selection.js";
import type { ProviderRequestGate } from "./provider-request-gate.js";
export interface LocalAuthOperation extends AuthOperationSummary { events: AuthEvent[]; prompt?: AuthPrompt; promptId?: string; methods: string[] }
interface PendingOperation { view: LocalAuthOperation; controller: AbortController; timer: ReturnType<typeof setTimeout>; answer?: { id: string; resolve(value: string): void; reject(error: Error): void }; running?: Promise<void> }
export class ProviderAuthService implements ProviderAuthentication {
  private readonly operations = new Map<string, PendingOperation>();
  public constructor(private readonly backend: AuthBackend,
    private readonly repository: AuthOperationStore, private readonly gate: ProviderRequestGate) {}
  public async recover(): Promise<void> {
    const rows = this.repository.pending();
    for (const row of rows) {
      const provider = row.provider;
      const credential = await this.backend.fingerprint(provider);
      const committed = row.status === "COMMITTING" && credential && credential === row.candidateHash;
      if (committed) this.repository.finishCommit(row.id, provider);
      else this.repository.update(row.id, "FAILED", "认证操作被重启中断，请重新发起。");
    }
    if (rows.length) await this.backend.refresh();
  }
  public async start(provider: string, action: "login" | "reauth"): Promise<AuthOperationSummary> {
    const p = await this.backend.describe(provider, action === "login");
    if (!p) throw new ModelManagementError("PROVIDER_NOT_FOUND", "供应商不存在。");
    if (action === "login" && p.configured) throw new ModelManagementError("AUTH_EXISTS", `已有认证配置，更换账户请使用 /auth ${provider} reauth。`);
    const methods = p.methods;
    if (!methods.length) throw new ModelManagementError("AUTH_AMBIENT", "该供应商需要通过本机环境配置认证，没有交互登录入口。");
    for (const op of this.operations.values()) if (op.view.providerId === provider && !terminal(op.view.status)) return Promise.resolve({ id: op.view.id, providerId: provider, status: op.view.status });
    const id = randomUUID(); const now = new Date().toISOString();
    this.repository.create(id, provider, now);
    const controller = new AbortController();
    const timer = setTimeout(() => this.cancel(id, "EXPIRED"), 10 * 60_000); timer.unref();
    this.operations.set(id, { view: { id, providerId: provider, status: "WAITING_LOCAL", methods, events: [] }, controller, timer });
    this.repository.audit("provider_auth_operation", { id, providerId: provider, status: "WAITING_LOCAL" });
    return Promise.resolve({ id, providerId: provider, status: "WAITING_LOCAL" });
  }
  public list(): AuthOperationSummary[] { return this.repository.list(); }
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
      const provider = op.view.providerId;
      const credential = await this.backend.prepare(provider, method, {
        signal: op.controller.signal,
        notify: (event) => { if (!op.controller.signal.aborted) { op.view.events.push(event); if (op.view.events.length > 10) op.view.events.shift(); } },
        prompt: (prompt) => this.prompt(op, prompt),
      });
      op.controller.signal.throwIfAborted();
      this.setStatus(op, "WAITING_IDLE"); this.clearInteraction(op, false);
      await this.gate.exclusive(provider, async () => {
        op.controller.signal.throwIfAborted();
        // Journal before touching the real store; candidate bytes never enter SQLite.
        this.repository.beginCommit(op.view.id, credential.fingerprint);
        op.view.status = "COMMITTING";
        await credential.commit();
        // Account revision must commit even if runtime refresh fails; old bindings must not reuse new credentials.
        this.repository.finishCommit(op.view.id, provider);
        await this.backend.refresh(provider);
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
  private required(id: string): PendingOperation { const op = this.operations.get(id); if (!op) throw new ModelManagementError("AUTH_NOT_FOUND", "认证操作不存在或已过期。"); return op; }
  private setStatus(op: PendingOperation, status: string): void { op.view.status = status; this.repository.update(op.view.id, status, op.view.error); this.repository.audit("provider_auth_operation", { id: op.view.id, providerId: op.view.providerId, status }); }
  private clearInteraction(op: PendingOperation, stopTimer = true): void { delete op.view.prompt; delete op.view.promptId; op.view.events = []; if (stopTimer) clearTimeout(op.timer); }
}
function terminal(status: string): boolean { return ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(status); }
