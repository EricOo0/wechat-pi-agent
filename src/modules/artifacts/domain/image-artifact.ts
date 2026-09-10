export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 25_000_000;
export const MAX_IMAGE_STORAGE_BYTES = 500 * 1024 * 1024;
export interface ImageArtifact {
  id: string;
  ownerId: string;
  taskId: string;
  revision: number;
  sourceTurnId: string;
  toolCallId: string;
  bytes: number;
  sha256: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  createdAt: string;
}
export interface ImageReplyContext {
  ownerId: string;
  taskId: string;
  revision: number;
  turnId: string;
  toolCallId: string;
}
export class ImageReplyError extends Error {
  public constructor(public readonly code: string, message: string) { super(message); this.name = "ImageReplyError"; }
}
