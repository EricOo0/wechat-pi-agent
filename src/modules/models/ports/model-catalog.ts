export interface ProviderSummary { id: string; name: string; configured: boolean; methods: string[] }
export interface ModelSummary { id: string; name: string; api: string }
export interface ModelCatalog {
  listProviders(): ProviderSummary[];
  listModels(providerId: string): Promise<ModelSummary[]>;
  checkAuthentication(providerId: string): Promise<boolean>;
  hasModel(providerId: string, modelId: string): boolean;
}
