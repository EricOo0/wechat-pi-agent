export type RoutedCommand =
  | { type: "new" }
  | { type: "status" }
  | { type: "message"; text: string };

export class CommandRouter {
  public route(text: string): RoutedCommand {
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
