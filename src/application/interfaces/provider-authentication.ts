export interface AuthOperationSummary { id: string; providerId: string; status: string; error?: string }
export interface ProviderAuthentication {
  start(provider: string, action: "login" | "reauth"): Promise<AuthOperationSummary>;
}
