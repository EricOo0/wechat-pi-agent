import type { AuthOperationSummary } from "./provider-authentication.js";
export type AuthPrompt = { signal?: AbortSignal } & (
  { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string } |
  { type: "select"; message: string; options: readonly { id: string; label: string; description?: string }[] });
export type AuthEvent = { type: "info"; message: string; links?: readonly { url: string; label?: string }[] } |
  { type: "auth_url"; url: string; instructions?: string } |
  { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number } |
  { type: "progress"; message: string };
export interface PreparedCredential { fingerprint: string; commit(): Promise<void> }
export interface AuthBackend {
  describe(provider: string, checkConfigured: boolean): Promise<{ id: string; methods: string[]; configured: boolean } | undefined>;
  prepare(provider: string, method: "oauth" | "api_key", interaction: {
    signal: AbortSignal; notify(event: AuthEvent): void; prompt(prompt: AuthPrompt): Promise<string>;
  }): Promise<PreparedCredential>;
  fingerprint(provider: string): Promise<string | undefined>;
  refresh(provider?: string): Promise<void>;
}
export interface AuthOperationStore {
  pending(): { id: string; provider: string; status: string; candidateHash?: string }[];
  create(id: string, provider: string, now: string): void;
  list(): AuthOperationSummary[];
  update(id: string, status: string, error?: string): void;
  beginCommit(id: string, fingerprint: string): void;
  finishCommit(id: string, provider: string): void;
  audit(type: string, data: unknown): void;
}
