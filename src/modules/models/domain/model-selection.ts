export interface ModelSelection { providerId: string; modelId: string; revision: number }
export interface TurnModelBinding extends ModelSelection { credentialRevision: number }
export class ModelManagementError extends Error {
  public constructor(public readonly code: string, message: string) { super(message); this.name = "ModelManagementError"; }
}
