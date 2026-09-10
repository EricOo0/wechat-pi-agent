import type { ImageArtifact } from "../domain/image-artifact.js";
export interface ImageStorage {
  save(image: ImageArtifact, data: Buffer): Promise<void>;
  read(image: ImageArtifact): Promise<Buffer>;
  remove(image: ImageArtifact): Promise<void>;
  sweepOrphans?(olderThan: number, isKnown: (id: string) => boolean): Promise<number>;
}
export interface ImageValidator {
  validate(data: Buffer): Promise<{mimeType: "image/png" | "image/jpeg"; width: number; height: number}>;
}
export type AuthorizedImageRead = (path: string, signal?: AbortSignal) => Promise<Buffer>;
