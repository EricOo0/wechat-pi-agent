export interface ToolRequest {
  name: string;
  input: unknown;
}

export interface ToolPolicy {
  allows(request: ToolRequest): boolean;
}

export class DenyAllToolsPolicy implements ToolPolicy {
  public allows(): boolean {
    return false;
  }
}
