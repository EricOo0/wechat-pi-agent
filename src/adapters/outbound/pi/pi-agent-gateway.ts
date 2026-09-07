import { mkdir, readFile } from "node:fs/promises";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent, CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Agent, AgentRunRequest, AgentRunResult } from "../../../application/interfaces/agent.js";
import type { AgentEvent } from "../../../domain/execution/step.js";
import type { InboundImage } from "../../../domain/messaging/inbound-message.js";
import type { Logger } from "pino";
import { loadSkillCatalog, skillIdentity, SkillLoadTracker } from "./skill-catalog.js";
import { loadSystemPrompt } from "./system-prompt.js";
import { createAgentTools } from "./tools/index.js";
import type { PermissionContext, PermissionService } from "../../../application/services/permission-service.js";
import { PolicyCompiler } from "../../../application/services/policy-compiler.js";
import type { SandboxExecutor } from "../../../application/interfaces/sandbox-executor.js";

export interface PiAgentGatewayOptions {
  logger?: Pick<Logger, "info" | "warn">;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"];
  authPath?: string;
  modelsPath?: string;
  modelsStorePath?: string;
  sessionDir: string;
  systemPromptPath: string;
  loadLocalSkills: boolean;
  toolSandboxRoot: string;
  permissions: PermissionService;
  executor: SandboxExecutor;
  deniedPaths: string[];
  protectedWritePaths: string[];
  deniedNetworkPorts: number[];
  allowModelNetwork?: boolean;
}

interface SessionHandle {
  session: AgentSession;
  manager: SessionManager;
  context: PermissionContext;
}

export class PiAgentGateway implements Agent {
  private readonly sessions = new Map<string, SessionHandle>();

  private constructor(
    private readonly options: PiAgentGatewayOptions,
    private readonly runtime: ModelRuntime,
    private readonly resourceLoader: DefaultResourceLoader,
    private readonly compiler: PolicyCompiler,
  ) {}

  public static async create(options: PiAgentGatewayOptions): Promise<PiAgentGateway> {
    await mkdir(options.sessionDir, { recursive: true });
    const [runtime, systemPrompt] = await Promise.all([
      ModelRuntime.create({
        ...(options.authPath === undefined ? {} : { authPath: options.authPath }),
        ...(options.modelsPath === undefined ? {} : { modelsPath: options.modelsPath }),
        ...(options.modelsStorePath === undefined ? {} : { modelsStorePath: options.modelsStorePath }),
        allowModelNetwork: options.allowModelNetwork ?? false,
        refreshOnCreate: true,
      }),
      loadSystemPrompt(options.systemPromptPath),
    ]);
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(options.cwd, agentDir);
    const catalog = await loadSkillCatalog(options.cwd, agentDir, settingsManager, options.loadLocalSkills);
    for (const skill of catalog.skills) options.logger?.info(skillIdentity(skill), "skill_loaded");
    for (const diagnostic of catalog.diagnostics) options.logger?.warn({ ...diagnostic }, diagnostic.type === "collision" ? "skill_shadowed" : "skill_diagnostic");
    const resourceLoader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir,
      settingsManager,
      skillsOverride: () => catalog,
      systemPrompt,
      noExtensions: true,
      noSkills: true, // Catalog already resolves Pi sources and bundled priority.
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const skillRoots = resourceLoader.getSkills().skills.map((skill) => skill.baseDir);
    const compiler = new PolicyCompiler({
      workspaceBase: options.toolSandboxRoot,
      skillRoots,
      deniedPaths: options.deniedPaths,
      protectedWritePaths: options.protectedWritePaths,
      deniedNetworkPorts: options.deniedNetworkPorts,
    });
    return new PiAgentGateway(options, runtime, resourceLoader, compiler);
  }

  public async runTurn(request: AgentRunRequest): Promise<AgentRunResult> {
    const handle = await this.getOrCreateSession(request);
    request.onSessionReady?.(handle.manager.getSessionId(), handle.manager.getSessionFile());
    const permission = this.options.permissions.snapshot(handle.context);
    request.onInvocation?.({
      systemPrompt: handle.session.systemPrompt,
      provider: this.options.provider,
      modelId: this.options.modelId,
      skills: this.resourceLoader.getSkills().skills.map((skill) => ({
        ...skillIdentity(skill),
        description: skill.description,
      })),
      tools: handle.session.getActiveToolNames(),
      permissionRevision: permission.revision,
      permissionMode: permission.policy.mode,
    });
    const tracker = new SkillLoadTracker(this.resourceLoader.getSkills().skills, this.compiler.workspace(handle.context.subject), (event) => request.onEvent?.(event));
    const unsubscribe = handle.session.subscribe((event) => {
      request.onEvent?.(this.mapEvent(event));
      tracker.observe(event);
    });
    const onAbort = () => { void handle.session.abort(); };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const expanded = await tracker.expand(request.prompt);
      if (expanded.error) {
        const piSessionFile = handle.manager.getSessionFile();
        return { text: expanded.error, piSessionId: handle.manager.getSessionId(), ...(piSessionFile === undefined ? {} : { piSessionFile }) };
      }
      const images = await this.loadImages(request.images ?? []);
      if (images.length > 0 && !handle.session.model?.input.includes("image")) {
        throw new Error(`Pi model does not support image input: ${this.options.provider}/${this.options.modelId}`);
      }
      await handle.session.prompt(expanded.prompt, { expandPromptTemplates: false, ...(images.length === 0 ? {} : { images }) });
      if (this.options.permissions.snapshot(handle.context).revision !== permission.revision) throw new Error("Permissions changed; turn cancelled");
      const text = handle.session.getLastAssistantText()?.trim();
      if (!text) throw new Error("Pi completed without assistant text");
      const piSessionFile = handle.manager.getSessionFile();
      return {
        text,
        piSessionId: handle.manager.getSessionId(),
        ...(piSessionFile === undefined ? {} : { piSessionFile }),
      };
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
      unsubscribe();
    }
  }

  public async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    const model = this.runtime.getModel(this.options.provider, this.options.modelId);
    if (!model) return { ready: false, reason: "pi_model_not_found" };
    try {
      const auth = await this.runtime.checkAuth(this.options.provider);
      return auth === undefined
        ? { ready: false, reason: "pi_auth_missing" }
        : { ready: true };
    } catch {
      return { ready: false, reason: "pi_auth_check_failed" };
    }
  }

  public dispose(): void {
    for (const handle of this.sessions.values()) handle.session.dispose();
    this.sessions.clear();
  }

  public abortSubject(principalId: string): void {
    for (const handle of this.sessions.values()) {
      if (handle.context.subject.principalId === principalId) void handle.session.abort().catch(() => {});
    }
  }

  private async getOrCreateSession(request: AgentRunRequest): Promise<SessionHandle> {
    if (!request.permissionContext) throw new Error("Authenticated permission context is required");
    const existing = this.sessions.get(request.session.id);
    if (existing !== undefined) {
      if (existing.context.subject.principalId !== request.permissionContext.subject.principalId) throw new Error("Session principal changed");
      existing.context = request.permissionContext;
      return existing;
    }
    const manager = request.session.piSessionFile
      ? SessionManager.open(request.session.piSessionFile, this.options.sessionDir, this.options.cwd)
      : SessionManager.create(this.options.cwd, this.options.sessionDir);
    const model = this.runtime.getModel(this.options.provider, this.options.modelId);
    if (!model) throw new Error(`Pi model not found: ${this.options.provider}/${this.options.modelId}`);
    const initialContext = request.permissionContext;
    const customTools = createAgentTools({
      context: () => this.sessions.get(request.session.id)?.context ?? initialContext,
      permissions: this.options.permissions, compiler: this.compiler, executor: this.options.executor,
    });
    const activeToolNames = customTools.map((tool) => tool.name);
    const { session } = await createAgentSession({
      cwd: this.options.cwd,
      model,
      modelRuntime: this.runtime,
      sessionManager: manager,
      resourceLoader: this.resourceLoader,
      tools: activeToolNames,
      customTools,
      thinkingLevel: this.options.thinkingLevel ?? "medium",
    });
    const unexpected = session.getActiveToolNames().filter((name) => !activeToolNames.includes(name));
    const unmanaged = customTools.filter((tool) => session.getToolDefinition(tool.name)?.execute !== tool.execute);
    if (unexpected.length > 0 || unmanaged.length > 0) {
      session.dispose();
      throw new Error(`Pi tool policy violation: unexpected or unmanaged tools (${[...unexpected, ...unmanaged.map((tool) => tool.name)].join(", ")})`);
    }
    const handle = { session, manager, context: request.permissionContext };
    this.sessions.set(request.session.id, handle);
    return handle;
  }

  private async loadImages(images: readonly InboundImage[]): Promise<ImageContent[]> {
    return Promise.all(images.map(async (image) => {
      const data = await readFile(image.path);
      if (data.length !== image.bytes) throw new Error(`Inbound image size changed after download: ${image.path}`);
      return { type: "image" as const, data: data.toString("base64"), mimeType: image.mimeType };
    }));
  }

  private mapEvent(event: AgentSessionEvent): AgentEvent {
    const data: Record<string, unknown> = {};
    if (event.type === "agent_end") data.willRetry = event.willRetry;
    if (event.type === "auto_retry_start") {
      data.attempt = event.attempt;
      data.maxAttempts = event.maxAttempts;
      data.delayMs = event.delayMs;
    }
    if (event.type === "tool_execution_start") {
      data.toolCallId = event.toolCallId;
      data.toolName = event.toolName;
      data.args = this.traceValue(event.args as unknown);
    }
    if (event.type === "tool_execution_update") {
      data.toolCallId = event.toolCallId;
      data.toolName = event.toolName;
      data.partialResult = this.traceValue(event.partialResult as unknown);
    }
    if (event.type === "tool_execution_end") {
      data.toolCallId = event.toolCallId;
      data.toolName = event.toolName;
      data.isError = event.isError;
      data.result = this.traceValue(event.result as unknown);
    }
    if (event.type === "message_update") data.messageEventType = event.assistantMessageEvent.type;
    return { type: event.type, at: new Date(), ...(Object.keys(data).length === 0 ? {} : { data }) };
  }

  private traceValue(value: unknown): unknown {
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length <= 8_192) return value;
      return { truncated: true, preview: serialized.slice(0, 8_192), originalCharacters: serialized.length };
    } catch {
      return { unserializable: true };
    }
  }
}
