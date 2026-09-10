import type { ModelCatalog } from "../ports/model-catalog.js";
import type { ModelSelectionRepository } from "../ports/model-selection-repository.js";
import type { ProviderAuthentication } from "../ports/provider-authentication.js";
import { ModelManagementError, type ModelSelection } from "../domain/model-selection.js";
import { commandHelp, type ManagementCommand } from "./command-catalog.js";
export class ModelManagement {
  public constructor(public readonly catalog: ModelCatalog, public readonly repository: ModelSelectionRepository,
    public readonly fallback: ModelSelection, private readonly authentication?: ProviderAuthentication,
    private readonly audit: (type: string, data: unknown) => void = () => {}, private readonly active: (provider: string) => number = () => 0, private readonly authOwner?: string) {}
  public current(owner: string): ModelSelection { return this.repository.get(owner, this.fallback); }
  public async select(owner: string, providerId: string, modelId: string, expectedRevision: number): Promise<ModelSelection> {
    const models = await this.catalog.listModels(providerId);
    if (!models.some((m) => m.id === modelId)) throw new ModelManagementError("MODEL_NOT_FOUND", "该供应商未找到可用的目标模型，当前选择未改变。");
    const choice = this.repository.select(owner, { providerId, modelId }, expectedRevision, this.fallback);
    this.audit("model_selection_changed", { owner, ...choice, status: "succeeded" }); return choice;
  }
  public async execute(owner: string, command: ManagementCommand): Promise<string> {
    try {
      if (command.type === "help") return commandHelp(command.name);
      const current = this.current(owner); const title = `当前选择：${current.providerId} / ${current.modelId}`;
      if (command.type === "providers") {
        const providers = this.catalog.listProviders().filter((p) => command.all || p.configured || p.id === current.providerId);
        return `${title}\n${this.page(providers.map((p) => `${p.id}：${p.configured ? "已配置认证" : "未配置认证"}`), command.page)}\n/provider all [页码] 查看全部供应商。\n/provider <供应商> 检查认证并查看模型。`;
      }
      if (command.type === "models") {
        const provider = command.provider ?? current.providerId;
        const models = await this.catalog.listModels(provider);
        return `${title}\n${provider} 认证检查通过（不保证所有模型的远端访问权限）。\n${this.page(models.map((m) => `${m.id}  ${m.name}`), command.page)}\n${command.provider ? `/provider ${provider} <模型ID>` : "/model <模型ID>"} 完成切换。\n${command.provider ? `/provider ${provider} page <页码>` : "/model page <页码>"} 翻页。当前选择未改变。`;
      }
      if (command.type === "select_model") {
        const choice = await this.select(owner, command.provider ?? current.providerId, command.modelId, current.revision);
        return `已选择 ${choice.providerId} / ${choice.modelId}，后续任务生效。\n${this.active(current.providerId) ? "当前运行任务继续使用原模型。\n" : ""}后续请求会向目标供应商提供本会话上下文。`;
      }
      if (!command.provider) return `${title}\n${this.catalog.listProviders().filter((p) => p.configured || p.id === current.providerId).map((p) => `${p.id}：${p.configured ? "已配置认证" : "未配置认证"}`).join("\n")}\n/auth <供应商> 查看认证方式。`;
      const provider = this.catalog.listProviders().find((p) => p.id === command.provider);
      if (!provider) throw new ModelManagementError("PROVIDER_NOT_FOUND", "未找到该供应商，请用 /provider all 查看。");
      if (command.action) {
        if (this.authOwner && owner !== this.authOwner) throw new ModelManagementError("AUTH_OWNER_REQUIRED", "只有本机所有者可以管理共享供应商账户。");
        if (!this.authentication) throw new ModelManagementError("AUTH_UNAVAILABLE", "本机认证管理尚未启用。");
        const operation = await this.authentication.start(provider.id, command.action);
        return `认证操作 ${operation.id} 已创建。\n请在运行 Agent 的电脑打开管理页 /admin/models，找到此操作并完成认证。不要将密钥发到微信。\n认证成功不自动切换模型；原选择保持不变。`;
      }
      const ready = await this.catalog.checkAuthentication(provider.id);
      return `${provider.id}：${ready ? "凭证检查通过" : "未配置认证"}\n可用认证方式：${provider.methods.join(", ") || "通过本机环境配置"}\n账户信息：Pi 未提供统一的账户展示信息。\n/auth ${provider.id} login 首次认证\n/auth ${provider.id} reauth 重新认证或更换账户`;
    } catch (error) {
      if (error instanceof ModelManagementError) { this.audit("model_management_failed", { code: error.code }); return error.message; }
      this.audit("model_management_failed", { code: "INTERNAL_ERROR" }); return "模型管理操作未完成，请检查本机配置后重试。";
    }
  }
  private page(lines: string[], page: number): string { const pages = Math.max(1, Math.ceil(lines.length / 15)); return `第 ${page}/${pages} 页\n${lines.slice((page - 1) * 15, page * 15).join("\n") || "本页没有条目"}`; }
}
