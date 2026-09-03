import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ILinkCredential } from "./protocol-types.js";

export class FileCredentialStore {
  public constructor(private readonly filePath: string) {}

  public async load(): Promise<ILinkCredential | undefined> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as ILinkCredential;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  public async save(credential: ILinkCredential): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
  }
}
