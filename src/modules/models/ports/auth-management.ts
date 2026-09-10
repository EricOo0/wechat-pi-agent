import type { AuthOperationSummary, ProviderAuthentication } from "./provider-authentication.js";
export interface AuthManagement extends ProviderAuthentication {
  list(): AuthOperationSummary[];
  get(id: string): (AuthOperationSummary & { events: readonly unknown[]; methods: string[]; prompt?: unknown; promptId?: string }) | undefined;
  begin(id: string, method: string): void;
  submit(id: string, promptId: string, value: string): void;
  cancel(id: string): void;
}
