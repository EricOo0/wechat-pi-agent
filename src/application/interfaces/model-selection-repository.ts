import type { ModelSelection, TurnModelBinding } from "../../domain/models/model-selection.js";
export interface ModelSelectionRepository {
  get(owner: string, fallback: ModelSelection): ModelSelection;
  select(owner: string, selection: Omit<ModelSelection, "revision">, expectedRevision: number, fallback: ModelSelection): ModelSelection;
  findBinding(id: string, owner: string): TurnModelBinding | undefined;
  bind(id: string, owner: string, selection: ModelSelection): TurnModelBinding;
  credentialRevision(provider: string): number;
}
