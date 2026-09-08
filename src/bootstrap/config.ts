import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKSPACE_ROOT: z.string().default("."),
  DATA_DIR: z.string().default("./data"),
  PERMISSION_EXECUTOR_ID: z.string().default(""),
  ADMIN_HOST: z.string().default("127.0.0.1"),
  ADMIN_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
  LOG_LEVEL: z.string().default("info"),
  MODEL_MANAGEMENT_ENABLED: booleanFromEnv.default(false),
  TRACE_RETENTION: z.coerce.number().int().min(1).max(10_000).default(100),
  SYSTEM_PROMPT_PATH: z.string().default("./src/prompts/wechat-assistant.md"),
  PI_PROVIDER: z.string().default("openai-codex"),
  PI_MODEL_ID: z.string().default(""),
  PI_THINKING_LEVEL: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).default("medium"),
  PI_AUTH_PATH: z.string().default("~/.pi/agent/auth.json"),
  PI_MODELS_STORE_PATH: z.string().default("~/.pi/agent/models.json"),
  PI_LOAD_LOCAL_SKILLS: booleanFromEnv.default(false),
  TOOL_SANDBOX_ROOT: z.string().default(""),
  TOOL_HTTP_ENABLED: booleanFromEnv.default(false),
  TOOL_HTTP_ALLOWED_HOSTS: z.string().default(""),
  TOOL_SHELL_ENABLED: booleanFromEnv.default(false),
  ILINK_BASE_URL: z.string().url().default("https://ilinkai.weixin.qq.com"),
  ILINK_CDN_BASE_URL: z.string().url().default("https://novac2c.cdn.weixin.qq.com/c2c"),
  ILINK_BOT_TOKEN: z.string().default(""),
  ILINK_BOT_ID: z.string().default(""),
  ILINK_USER_ID: z.string().default(""),
  ILINK_ALLOWED_SENDER_ID: z.string().default(""),
  ILINK_AUTO_LOGIN: booleanFromEnv.default(false),
  DRY_RUN: booleanFromEnv.default(false),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  workspaceRoot: string;
  dataDir: string;
  databasePath: string;
  permissionDatabasePath: string;
  permissionExecutorId: string;
  credentialPath: string;
  settingsPath: string;
  piSessionDir: string;
  inboundMediaDir: string;
  modelManagementEnabled: boolean;
  adminHost: string;
  adminPort: number;
  logLevel: string;
  traceRetention: number;
  systemPromptPath: string;
  pi: {
    provider: string;
    modelId: string;
    thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    authPath: string;
    modelsStorePath: string;
    loadLocalSkills: boolean;
  };
  tools: {
    sandboxRoot: string;
    httpEnabled: boolean;
    httpAllowedHosts: string[];
    shellEnabled: boolean;
  };
  ilink: {
    baseUrl: string;
    cdnBaseUrl: string;
    botToken: string;
    botId: string;
    userId: string;
    allowedSenderId: string;
    autoLogin: boolean;
  };
  dryRun: boolean;
}

function expandHome(value: string): string {
  return value === "~" ? homedir() : value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : resolve(value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const value = schema.parse(env);
  const dataDir = resolve(value.DATA_DIR);
  return {
    nodeEnv: value.NODE_ENV,
    workspaceRoot: resolve(value.WORKSPACE_ROOT),
    dataDir,
    databasePath: resolve(dataDir, "app.db"),
    permissionDatabasePath: resolve(dataDir, "permissions.db"),
    permissionExecutorId: value.PERMISSION_EXECUTOR_ID,
    credentialPath: resolve(dataDir, "credentials", "ilink.json"),
    settingsPath: resolve(dataDir, "settings.json"),
    piSessionDir: resolve(dataDir, "pi-sessions"),
    inboundMediaDir: resolve(dataDir, "inbound-media"),
    modelManagementEnabled: value.MODEL_MANAGEMENT_ENABLED,
    adminHost: value.ADMIN_HOST,
    adminPort: value.ADMIN_PORT,
    logLevel: value.LOG_LEVEL,
    traceRetention: value.TRACE_RETENTION,
    systemPromptPath: resolve(value.SYSTEM_PROMPT_PATH),
    pi: {
      provider: value.PI_PROVIDER,
      modelId: value.PI_MODEL_ID,
      thinkingLevel: value.PI_THINKING_LEVEL,
      authPath: expandHome(value.PI_AUTH_PATH),
      modelsStorePath: expandHome(value.PI_MODELS_STORE_PATH),
      loadLocalSkills: value.PI_LOAD_LOCAL_SKILLS,
    },
    tools: {
      sandboxRoot: value.TOOL_SANDBOX_ROOT ? resolve(value.TOOL_SANDBOX_ROOT) : resolve(dataDir, "tool-workspace"),
      httpEnabled: value.TOOL_HTTP_ENABLED,
      httpAllowedHosts: value.TOOL_HTTP_ALLOWED_HOSTS.split(",").map((host) => host.trim()).filter(Boolean),
      shellEnabled: value.TOOL_SHELL_ENABLED,
    },
    ilink: {
      baseUrl: value.ILINK_BASE_URL,
      cdnBaseUrl: value.ILINK_CDN_BASE_URL,
      botToken: value.ILINK_BOT_TOKEN,
      botId: value.ILINK_BOT_ID,
      userId: value.ILINK_USER_ID,
      allowedSenderId: value.ILINK_ALLOWED_SENDER_ID || value.ILINK_USER_ID,
      autoLogin: value.ILINK_AUTO_LOGIN,
    },
    dryRun: value.DRY_RUN,
  };
}
