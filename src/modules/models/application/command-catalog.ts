export const COMMANDS = [
  { name: "task", summary: "查看和控制当前任务", usage: "/task status\n/task list\n/task pause\n/task cancel\n/task resume\n/task budget <追加轮数>", note: "新消息进入当前未关闭任务。初始 30 轮 ReAct；追加预算需明确轮数。" },
  { name: "provider", summary: "查看供应商和认证状态", usage: "/provider\n/provider all [页码]\n/provider <供应商> [page <页码>]\n/provider <供应商> <模型ID>", note: "只指定供应商时检查认证并展示模型；选定模型后才切换。" },
  { name: "model", summary: "查看或切换当前供应商的模型", usage: "/model [page <页码>]\n/model <模型ID>", note: "始终操作当前供应商。/models 是只读列表别名。" },
  { name: "auth", summary: "查看认证或发起本机登录", usage: "/auth\n/auth <供应商>\n/auth <供应商> login\n/auth <供应商> reauth", note: "登录或更换账户在运行 Agent 的电脑完成，不要向微信发送密钥。" },
  { name: "new", summary: "新建会话", usage: "/new", note: "归档当前会话，下一条消息创建新会话。" },
  { name: "status", summary: "查看运行状态", usage: "/status", note: "显示当前会话和任务。" },
  { name: "permissions", summary: "查看当前权限", usage: "/permissions", note: "查看当前用户权限。" },
];
export function commandHelp(name?: string): string {
  const command = COMMANDS.find((entry) => entry.name === name);
  if (command) return `${command.summary}\n\n${command.usage}\n\n${command.note}\n管理命令请单独发送，不附带文件或图片。`;
  return `常用命令\n${COMMANDS.map((entry) => `/${entry.name}  ${entry.summary}`).join("\n")}\n\n-help、--help 或 /help 查看帮助。\n输入“命令 -help”查看用法，例如 /provider -help（也支持 --help）。`;
}
export type ManagementCommand =
  | { type: "help"; name?: string }
  | { type: "providers"; all: boolean; page: number }
  | { type: "models"; provider?: string; page: number }
  | { type: "select_model"; provider?: string; modelId: string }
  | { type: "auth"; provider?: string; action?: "login" | "reauth" };
export function parseManagementCommand(text: string): ManagementCommand | undefined {
  const value = text.trim();
  if (["-help", "--help", "/help"].includes(value)) return { type: "help" };
  const parts = value.split(/\s+/u); const head = parts[0];
  const helpName = head?.slice(1);
  if (parts.length === 2 && ["-help", "--help"].includes(parts[1]!) && COMMANDS.some((c) => c.name === helpName)) return { type: "help", name: helpName! };
  const valid = (token: string | undefined) => token !== undefined && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u.test(token);
  const page = (token: string | undefined) => token !== undefined && /^[1-9][0-9]{0,3}$/u.test(token);
  if (head === "/provider") {
    if (parts.length === 1) return { type: "providers", all: false, page: 1 };
    if (parts[1] === "all" && (parts.length === 2 || (parts.length === 3 && page(parts[2])))) return { type: "providers", all: true, page: Number(parts[2] ?? 1) };
    if (parts[1] === "all") return undefined;
    if (valid(parts[1])) {
      if (parts.length === 2) return { type: "models", provider: parts[1]!, page: 1 };
      if (parts.length === 3 && valid(parts[2])) return { type: "select_model", provider: parts[1]!, modelId: parts[2]! };
      if (parts.length === 4 && parts[2] === "page" && page(parts[3])) return { type: "models", provider: parts[1]!, page: Number(parts[3]) };
    }
  }
  if (head === "/model" || head === "/models") {
    if (parts.length === 1) return { type: "models", page: 1 };
    if (parts.length === 3 && parts[1] === "page" && page(parts[2])) return { type: "models", page: Number(parts[2]) };
    if (head === "/model" && parts.length === 2 && valid(parts[1])) return { type: "select_model", modelId: parts[1]! };
  }
  if (head === "/auth") {
    if (parts.length === 1) return { type: "auth" };
    if (valid(parts[1])) {
      if (parts.length === 2) return { type: "auth", provider: parts[1]! };
      if (parts.length === 3 && (parts[2] === "login" || parts[2] === "reauth")) return { type: "auth", provider: parts[1]!, action: parts[2] };
    }
  }
  return undefined;
}
