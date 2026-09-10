import { createHash } from "node:crypto";
import { InMemoryCredentialStore, type Credential, type CredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ProviderAuthService, type AuthBackend, type ProviderRequestGate } from "../../modules/models/index.js";
import type { SqliteModelSelectionRepository } from "../sqlite/sqlite-model-selection-repository.js";
import { SqliteAuthOperationStore } from "../sqlite/sqlite-auth-operation-store.js";
export type { LocalAuthOperation } from "../../modules/models/index.js";

class PiAuthBackend implements AuthBackend {
  public constructor(private readonly runtime: ModelRuntime, private readonly credentials: CredentialStore) {}
  public async describe(id: string, checkConfigured: boolean) {
    const p = this.runtime.getProvider(id);
    if (!p) return undefined;
    return { id, configured: checkConfigured && Boolean((await this.credentials.read(id)) || this.runtime.hasConfiguredAuth(id)),
      methods: [...(p.auth.oauth?.login ? ["oauth"] : []), ...(p.auth.apiKey?.login ? ["api_key"] : [])] };
  }
  public async prepare(id: string, method: "oauth" | "api_key", interaction: Parameters<AuthBackend["prepare"]>[2]) {
    const staging = new InMemoryCredentialStore();
    const stagedRuntime = await ModelRuntime.create({ credentials: staging, allowModelNetwork: false, refreshOnCreate: false });
    const provider = this.runtime.getProvider(id);
    if (!provider) throw new Error("Provider is unavailable");
    stagedRuntime.registerNativeProvider(provider);
    const credential = await stagedRuntime.login(id, method, interaction);
    return { fingerprint: fingerprint(credential), commit: async () => { await this.credentials.modify(id, () => Promise.resolve(credential)); } };
  }
  public async fingerprint(provider: string): Promise<string | undefined> {
    const credential = await this.credentials.read(provider);
    return credential ? fingerprint(credential) : undefined;
  }
  public async refresh(provider?: string): Promise<void> {
    await this.runtime.refresh({ ...(provider ? { providers: [provider] } : {}), allowNetwork: false });
  }
}

/** Compatibility composition: lifecycle is in the core; this file only adapts Pi. */
export class PiProviderAuthentication extends ProviderAuthService {
  public constructor(runtime: ModelRuntime, credentials: CredentialStore, repository: SqliteModelSelectionRepository, gate: ProviderRequestGate) {
    super(new PiAuthBackend(runtime, credentials), new SqliteAuthOperationStore(repository), gate);
  }
}
function fingerprint(credential: Credential): string { return createHash("sha256").update(JSON.stringify(credential)).digest("hex"); }
