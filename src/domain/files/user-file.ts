export interface InboundFileReference {
  itemIndex: number;
  name: string;
  declaredBytes?: number;
  media?: { encrypt_query_param?: string; aes_key?: string; encrypt_type?: number; full_url?: string };
}
export interface UserFile {
  id: string;
  ownerId: string;
  messageId: string;
  itemIndex: number;
  name: string;
  status: "ready" | "failed";
  bytes: number;
  sha256: string;
  mimeType: string;
  errorCode?: string;
  createdAt: string;
}
export interface ModelFileRef { fileId: string; scope: string; remoteId: string }
export function fileSummary(file: UserFile) {
  return { id: file.id, name: file.name, status: file.status, bytes: file.bytes, mimeType: file.mimeType, createdAt: file.createdAt, ...(file.errorCode ? { errorCode: file.errorCode } : {}) };
}
export class FileInputError extends Error {
  public constructor(public readonly code: string, message: string) { super(message); this.name = "FileInputError"; }
}
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 3;
