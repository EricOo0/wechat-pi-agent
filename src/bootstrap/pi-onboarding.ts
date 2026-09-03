import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Logger } from "pino";

interface StoredSettings {
  piProvider?: string;
  piModelId?: string;
}

export interface PiOnboardingOptions {
  provider: string;
  configuredModelId: string;
  authPath: string;
  modelsStorePath: string;
  settingsPath: string;
  logger: Logger;
}

export async function resolvePiModelId(options: PiOnboardingOptions): Promise<string> {
  if (options.configuredModelId.trim()) return options.configuredModelId.trim();
  const stored = await loadSettings(options.settingsPath);
  const runtime = await ModelRuntime.create({
    authPath: options.authPath,
    modelsStorePath: options.modelsStorePath,
    allowModelNetwork: false,
    refreshOnCreate: true,
  });
  const auth = await runtime.checkAuth(options.provider);
  if (auth === undefined) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("Pi OAuth is not configured and startup is non-interactive. Run npm run dev in a terminal.");
    }
    process.stdout.write(`\n未检测到 ${options.provider} 登录，正在打开浏览器完成 OAuth...\n`);
    await runtime.login(options.provider, "oauth", {
      prompt: answerAuthPrompt,
      notify: notifyAuthEvent,
    });
    process.stdout.write("✅ Pi Provider 登录成功。\n");
  }

  if (stored.piProvider === options.provider && stored.piModelId && runtime.getModel(options.provider, stored.piModelId)) {
    return stored.piModelId;
  }

  const available = await runtime.getAvailable(options.provider);
  const models = available.length > 0 ? available : runtime.getModels(options.provider);
  if (models.length === 0) throw new Error(`No models are available for provider ${options.provider}`);

  if (models.length > 1 && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error("Pi model is not bound and startup is non-interactive. Set PI_MODEL_ID or run npm run dev in a terminal.");
  }
  const modelId = models.length === 1
    ? models[0]!.id
    : await selectModel(models.map((model) => ({ id: model.id, name: model.name })));
  await saveSettings(options.settingsPath, {
    ...stored,
    piProvider: options.provider,
    piModelId: modelId,
  });
  options.logger.info({ provider: options.provider, modelId }, "Pi model selected and persisted");
  process.stdout.write(`✅ 已绑定模型：${options.provider}/${modelId}\n`);
  return modelId;
}

async function answerAuthPrompt(prompt: AuthPrompt): Promise<string> {
  if (prompt.type === "select") {
    const browser = prompt.options.find((option) => option.id === "browser");
    if (browser !== undefined) {
      process.stdout.write(`选择登录方式：${browser.label}\n`);
      return browser.id;
    }
    return selectOption(prompt.message, prompt.options);
  }
  return ask(`${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `, prompt.signal);
}

function notifyAuthEvent(event: AuthEvent): void {
  switch (event.type) {
    case "auth_url":
      process.stdout.write(`\n请在浏览器完成登录：\n${event.url}\n`);
      if (event.instructions) process.stdout.write(`${event.instructions}\n`);
      openBrowser(event.url);
      break;
    case "device_code":
      process.stdout.write(`\n请打开 ${event.verificationUri} 并输入代码：${event.userCode}\n`);
      openBrowser(event.verificationUri);
      break;
    case "info":
    case "progress":
      process.stdout.write(`${event.message}\n`);
      break;
  }
}

async function selectModel(models: readonly { id: string; name: string }[]): Promise<string> {
  return selectOption("请选择本服务使用的模型：", models.map((model) => ({ id: model.id, label: `${model.name} (${model.id})` })));
}

async function selectOption(message: string, options: readonly { id: string; label: string; description?: string }[]): Promise<string> {
  process.stdout.write(`\n${message}\n`);
  options.forEach((option, index) => process.stdout.write(`  ${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}\n`));
  while (true) {
    const answer = await ask(`请输入序号 [1-${options.length}]：`);
    const selected = options[Number.parseInt(answer, 10) - 1];
    if (selected !== undefined) return selected.id;
    process.stdout.write("输入无效，请重新选择。\n");
  }
}

async function ask(message: string, signal?: AbortSignal): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return signal === undefined
      ? await readline.question(message)
      : await readline.question(message, { signal });
  } finally {
    readline.close();
  }
}

function openBrowser(target: string): void {
  const [command, args] = process.platform === "darwin"
    ? ["open", [target]] as const
    : process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", target]] as const
      : ["xdg-open", [target]] as const;
  spawn(command, args, { detached: true, stdio: "ignore" }).on("error", () => undefined).unref();
}

async function loadSettings(path: string): Promise<StoredSettings> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as StoredSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function saveSettings(path: string, settings: StoredSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}
