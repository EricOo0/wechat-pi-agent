import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ModelCatalog, ProviderSummary, ModelSummary } from "../../../application/interfaces/model-catalog.js";
import { ModelManagementError } from "../../../domain/models/model-selection.js";
export class PiModelCatalog implements ModelCatalog {
  public constructor(public readonly runtime: ModelRuntime) {}
  public listProviders(): ProviderSummary[] {
    return this.runtime.getProviders().map((p) => ({ id: p.id, name: p.name, configured: this.runtime.hasConfiguredAuth(p.id),
      methods: [...(p.auth.oauth?.login ? ["oauth"] : []), ...(p.auth.apiKey?.login ? ["api_key"] : [])] })).sort((a, b) => a.id.localeCompare(b.id));
  }
  public async checkAuthentication(provider: string): Promise<boolean> {
    if (!this.runtime.getProvider(provider)) throw new ModelManagementError("PROVIDER_NOT_FOUND", "未找到该供应商，请用 /provider all 查看已注册供应商。");
    try { return (await this.runtime.checkAuth(provider, { signal: AbortSignal.timeout(15_000) })) !== undefined; }
    catch { throw new ModelManagementError("AUTH_CHECK_FAILED", "认证检查失败，请在本机检查登录或重新认证；当前选择未改变。"); }
  }
  public async listModels(provider: string): Promise<ModelSummary[]> {
    if (!await this.checkAuthentication(provider)) throw new ModelManagementError("AUTH_REQUIRED", `尚未配置认证，请使用 /auth ${provider} login，并在运行 Agent 的电脑完成。`);
    try { return (await this.runtime.getAvailable(provider, { signal: AbortSignal.timeout(15_000) })).map((m) => ({ id: m.id, name: m.name, api: m.api })); }
    catch { throw new ModelManagementError("MODEL_LIST_FAILED", "模型列表获取失败，请检查该供应商的配置。当前选择未改变。"); }
  }
  public hasModel(provider: string, id: string): boolean { return this.runtime.getModel(provider, id) !== undefined; }
}
