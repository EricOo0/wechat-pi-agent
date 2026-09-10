import type { UserFileRepository } from "../ports/user-file-repository.js";
import { FileInputError, fileSummary } from "../domain/user-file.js";
export class FileLibraryService {
  public constructor(private readonly repository: UserFileRepository) {}
  public list(owner: string, query = "", offset = 0) {
    const files = this.repository.list(owner, query, offset).map(fileSummary);
    return { files, nextOffset: files.length === 20 ? offset + 20 : null };
  }
  public requireReady(owner: string, fileId: string) {
    const file = this.repository.get(owner, fileId);
    if (!file || file.status !== "ready") throw new FileInputError("FILE_NOT_FOUND", "找不到可用文件，请查询文件库或重新发送。");
    return fileSummary(file);
  }
}
