import type { UserFile } from "../../domain/files/user-file.js";
export interface FileStorage {
  save(ownerId: string, fileId: string, data: Buffer): Promise<void>;
  read(file: UserFile): Promise<Buffer>;
}
