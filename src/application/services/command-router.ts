import { parseManagementCommand, type ManagementCommand } from "./command-catalog.js";
export type RoutedCommand =
  | { type: "management"; command: ManagementCommand }
  | { type: "new" }
  | { type: "status" }
  | { type: "message"; text: string };

export class CommandRouter {
  public route(text: string): RoutedCommand {
    const management = parseManagementCommand(text);
    if (management) return { type: "management", command: management };
    const normalized = text.trim();
    const command = normalized.match(/^\/(new|status)(?:@[\w.-]+)?\s*$/iu)?.[1]?.toLowerCase();
    if (command === "new") {
      return { type: "new" };
    }
    if (command === "status") {
      return { type: "status" };
    }
    return { type: "message", text };
  }

  public parse(text: string): RoutedCommand {
    return this.route(text);
  }
}
