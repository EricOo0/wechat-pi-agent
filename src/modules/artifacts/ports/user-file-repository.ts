import type { ModelFileRef, UserFile } from "../domain/user-file.js";
export interface UserFileRepository {
  save(file: UserFile): void;
  get(ownerId: string, fileId: string): UserFile | undefined;
  list(ownerId: string, query?: string, offset?: number): UserFile[];
  usedBytes(ownerId: string): number;
  getModelRef(fileId: string, scope: string): ModelFileRef | undefined;
  saveModelRef(ref: ModelFileRef): void;
  deleteModelRef(fileId: string, scope: string): void;
}
