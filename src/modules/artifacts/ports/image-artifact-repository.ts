import type { ImageArtifact } from "../domain/image-artifact.js";
export interface ImageArtifactRepository {
  get(ownerId: string, id: string): ImageArtifact | undefined;
  getById(id: string): ImageArtifact | undefined;
  getByToolCall(ownerId: string, turnId: string, toolCallId: string): ImageArtifact | undefined;
  saveWithinQuota(image: ImageArtifact, maxBytes: number): void;
  usedBytes(ownerId: string): number;
  select(image: ImageArtifact): void;
  selected(ownerId: string, taskId: string, revision: number): ImageArtifact[];
  clear(ownerId: string, taskId: string, revision: number): void;
  listBefore(cutoff: string): ImageArtifact[];
  delete(id: string): void;
}
