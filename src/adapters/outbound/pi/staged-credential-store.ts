import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CredentialStore } from "@earendil-works/pi-ai";
/** Pi 0.84.3 does not export AuthStorage publicly. Keep this pinned SDK bridge isolated;
 * reuse its cross-process locks and provider-scoped modify rather than editing auth.json. */
export async function openPiCredentialStore(path: string): Promise<CredentialStore> {
  const packagePath = findPackageJSON("@earendil-works/pi-coding-agent", import.meta.url);
  if (!packagePath) throw new Error("Pi package could not be located");
  const url = pathToFileURL(join(dirname(packagePath), "dist/core/auth-storage.js"));
  const module = await import(url.href) as { AuthStorage: { create(path: string): CredentialStore } };
  return module.AuthStorage.create(path);
}
