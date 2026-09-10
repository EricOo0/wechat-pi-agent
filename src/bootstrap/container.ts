import { TaskRoutes } from "../entrypoints/admin-http/task-routes.js";
import { TaskManager } from "../modules/tasks/index.js";
import { PiTaskReviewer } from "../adapters/pi/pi-task-reviewer.js";
import { DryRunTaskReviewer } from "../adapters/dry-run/dry-run-task-reviewer.js";
import { runBackgroundLoops } from "./lifecycle.js";
import { IdleSessionLoop } from "../workers/idle-session-loop.js";
import { AgentRuntime } from "../runtime/agent/index.js";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ModelManagement } from "../modules/models/index.js";
import { SqliteModelSelectionRepository } from "../adapters/sqlite/sqlite-model-selection-repository.js";
import { PiModelCatalog } from "../adapters/models/pi-model-catalog.js";
import { PiProviderAuthentication } from "../adapters/models/pi-provider-authentication.js";
import { ProviderRequestGate } from "../modules/models/index.js";
import { openPiCredentialStore } from "../adapters/models/staged-credential-store.js";
import { ModelRoutes } from "../entrypoints/admin-http/model-routes.js";
import { MarkdownMemoryStore } from "../adapters/filesystem/markdown-memory-store.js";
import { SqliteMemoryJobRepository } from "../adapters/sqlite/sqlite-memory-job-repository.js";
import { PiMemoryGenerator } from "../adapters/pi/pi-memory-generator.js";
import { UserMemoryService } from "../modules/memory/index.js";
import { EndSession } from "../modules/conversation/index.js";
import { ExpireIdleSessions } from "../modules/conversation/index.js";
import { GenerateSessionMemory } from "../modules/memory/index.js";
import { MemoryWorkerLoop } from "../workers/memory-worker-loop.js";
import { SqliteUserFileRepository } from "../adapters/sqlite/sqlite-user-file-repository.js";
import { LocalFileStorage } from "../adapters/filesystem/local-file-storage.js";
import { ILinkFileDownloader } from "../adapters/ilink/ilink-file-downloader.js";
import { SaveInboundFiles } from "../modules/artifacts/index.js";
import { mkdir } from "node:fs/promises";
import { realpathSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { Agent } from "../runtime/agent/ports/agent.js";
import type { Channel } from "../modules/messaging/index.js";
import { OutboxWorkerLoop } from "../workers/outbox-worker-loop.js";
import { TurnWorkerLoop } from "../workers/turn-worker-loop.js";
import { DeliverReply } from "../modules/messaging/index.js";
import { IngestMessage } from "../modules/messaging/index.js";
import { RecoverInterruptedWork } from "./recover-interrupted-work.js";
import { RunNextTurn } from "../modules/turns/index.js";
import { ReplyChunker } from "../modules/messaging/index.js";
import { AdminServer } from "../entrypoints/admin-http/server.js";
import { RuntimeHealth } from "../modules/observability/index.js";
import { PollLoop } from "../workers/poll-loop.js";
import { DryRunChannel } from "../adapters/dry-run/dry-run-channel.js";
import { FileCredentialStore } from "../adapters/ilink/file-credential-store.js";
import { ILinkHttpClient } from "../adapters/ilink/ilink-http-client.js";
import { ILinkQrLogin } from "../adapters/ilink/qr-login.js";
import type { ILinkCredential } from "../adapters/ilink/protocol-types.js";
import { PrometheusTelemetry } from "../adapters/telemetry/metrics.js";
import { createLogger } from "../adapters/telemetry/logger.js";
import { DryRunAgent } from "../adapters/dry-run/dry-run-agent.js";
import { PiAgentGateway } from "../adapters/pi/pi-agent-gateway.js";
import { SqliteControlPlane } from "../adapters/sqlite/index.js";
import { AllowAllSendersPolicy, ExactSenderPolicy } from "../modules/messaging/index.js";
import type { AppConfig } from "./config.js";
import { resolvePiModelId } from "./pi-onboarding.js";
import { PermissionService } from "../modules/permissions/index.js";
import { SqlitePermissionRepository } from "../adapters/sqlite/sqlite-permission-repository.js";
import { LocalSandboxExecutor } from "../adapters/sandbox/local-sandbox-executor.js";
import { principalId, subjectKey } from "../modules/permissions/index.js";

export interface AppRuntime {
  run(signal: AbortSignal): Promise<void>;
  close(endSessions?: boolean): Promise<void>;
  logger: Logger;
  accountId: string;
}

export async function buildApp(config: AppConfig): Promise<AppRuntime> {
  await mkdir(config.dataDir, { recursive: true });
  const logger = createLogger(config.logLevel);
  const telemetry = new PrometheusTelemetry();
  const health = new RuntimeHealth();
  const credential = config.dryRun ? undefined : await resolveCredential(config, logger);
  if (!config.dryRun && credential === undefined) {
    throw new Error("iLink credential not found. Run `npm run ilink:login`, set ILINK_AUTO_LOGIN=true, or configure ILINK_BOT_TOKEN and ILINK_BOT_ID.");
  }
  const allowedSender = config.ilink.allowedSenderId || credential?.userId || "";
  if (!config.dryRun && !allowedSender) {
    throw new Error("iLink sender ID is unavailable. Set ILINK_ALLOWED_SENDER_ID or login again so iLink returns userId.");
  }
  const accountId = config.dryRun ? "dry-run-account" : credential?.botId ?? config.ilink.botId;
  const control = new SqliteControlPlane(config.databasePath, { traceRetention: config.traceRetention });
  control.migrate();
  const memoryRoot = resolve(config.dataDir, "memory");
  const memoryStore = new MarkdownMemoryStore(memoryRoot);
  const memory = new UserMemoryService(memoryStore);
  const memoryJobs = new SqliteMemoryJobRepository(config.databasePath);
  const fileRepository = new SqliteUserFileRepository(config.databasePath);
  const fileRoot = resolve(config.dataDir, "files");
  const fileStorage = new LocalFileStorage(fileRoot);
  const saveFiles = new SaveInboundFiles(fileRepository, fileStorage, new ILinkFileDownloader(config.ilink.cdnBaseUrl));
  const executor = new LocalSandboxExecutor();
  const permissionStore = new SqlitePermissionRepository(config.permissionDatabasePath);
  const databaseFiles = [config.databasePath, config.permissionDatabasePath].flatMap((path) => [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]);
  const deniedPaths = [memoryRoot, resolve(config.dataDir, ".service.lock"), fileRoot, ...databaseFiles, resolve(config.dataDir, "credentials"), config.piSessionDir,
    config.inboundMediaDir, config.settingsPath, config.pi.authPath, config.pi.modelsStorePath,
    resolve(config.workspaceRoot, ".env"), resolve(process.cwd(), ".env"), resolve(config.dataDir, "executor-id")];
  const protectedWritePaths = ["src", "dist", "scripts", "node_modules", "package.json", "package-lock.json", ".git", "tsconfig.json", "tsconfig.build.json"]
    .map((path) => resolve(import.meta.dirname, "../..", path));
  // In dist, ../.. is still the application root. In source dev it is too.
  let liveGateway: PiAgentGateway | undefined;
  await mkdir(config.tools.sandboxRoot, { recursive: true, mode: 0o700 });
  const permissions = new PermissionService(permissionStore, {
    executorId: resolvePermissionExecutorId(config),
    workspaceId: realpathSync(config.workspaceRoot),
    ownerPrincipalId: principalId(accountId, allowedSender),
    protectedPaths: deniedPaths,
    workspaceBase: config.tools.sandboxRoot,
    onChange: (subject) => { executor.revoke(subjectKey(subject)); liveGateway?.abortSubject(subject.principalId); taskManager?.abortOwner(subjectKey(subject)); },
  });
  const channel: Channel = config.dryRun
    ? new DryRunChannel()
    : new ILinkHttpClient({
        baseUrl: credential?.baseUrl ?? config.ilink.baseUrl,
        cdnBaseUrl: config.ilink.cdnBaseUrl,
        botToken: credential?.botToken ?? config.ilink.botToken,
        mediaDir: config.inboundMediaDir,
        onMediaError: (error) => logger.warn({ err: error }, "iLink image download failed"),
      });
  const modelSelections = new SqliteModelSelectionRepository(config.databasePath);
  const managementOwner = subjectKey({ principalId: principalId(accountId, allowedSender), executorId: resolvePermissionExecutorId(config), workspaceId: realpathSync(config.workspaceRoot) });
  const storedSelection = modelSelections.get(managementOwner, { providerId: config.pi.provider, modelId: config.pi.modelId, revision: 0 });
  const piModelId = config.dryRun ? "" : await resolvePiModelId({
    provider: storedSelection.providerId,
    configuredModelId: storedSelection.modelId,
    authPath: config.pi.authPath,
    modelsStorePath: config.pi.modelsStorePath,
    settingsPath: config.settingsPath,
    logger,
  });
  const gate = new ProviderRequestGate();
  const credentials = await openPiCredentialStore(config.pi.authPath);
  const runtime = await ModelRuntime.create({ credentials, modelsStorePath: config.pi.modelsStorePath, allowModelNetwork: false, refreshOnCreate: false });
  const authentication = new PiProviderAuthentication(runtime, credentials, modelSelections, gate);
  await authentication.recover();
  if (!config.dryRun) await runtime.refresh({ allowNetwork: false });
  const models = new ModelManagement(new PiModelCatalog(runtime), modelSelections,
    { providerId: storedSelection.providerId, modelId: piModelId, revision: 0 },
    authentication, (type, data) => modelSelections.audit(type, data), provider => gate.activeCount(provider), managementOwner);
  const agent: Agent = config.dryRun
    ? new DryRunAgent()
    : await PiAgentGateway.create({
        logger,
        runtime, models, gate, modelOwner: managementOwner,
        files: { repository: fileRepository, storage: fileStorage },
        memory,
        cwd: config.workspaceRoot,
        provider: storedSelection.providerId,
        modelId: piModelId,
        thinkingLevel: config.pi.thinkingLevel,
        authPath: config.pi.authPath,
        modelsStorePath: config.pi.modelsStorePath,
        sessionDir: config.piSessionDir,
        systemPromptPath: config.systemPromptPath,
        loadLocalSkills: config.pi.loadLocalSkills,
        toolSandboxRoot: config.tools.sandboxRoot,
        permissions, executor, deniedPaths, protectedWritePaths, deniedNetworkPorts: [config.adminPort],
      });
  if (agent instanceof PiAgentGateway) liveGateway = agent;
  if (config.tools.shellEnabled || config.tools.httpEnabled || config.tools.httpAllowedHosts.length) {
    logger.info("Legacy TOOL_SHELL_ENABLED / TOOL_HTTP_* flags are ignored; authenticated user permission grants control all tools");
  }

  const taskStore = control.enableTasks((message, sessionId) => subjectKey(permissions.context(message, sessionId).subject));
  const taskManager = new TaskManager(taskStore, config.dryRun ? new DryRunTaskReviewer() : new PiTaskReviewer(runtime, models, gate), permissions);
  const senderPolicy = config.dryRun ? new AllowAllSendersPolicy() : new ExactSenderPolicy(allowedSender);
  const ingest = new IngestMessage(control, senderPolicy, telemetry, permissions, taskManager);
  const ownerId = `worker_${randomUUID()}`;
  const endSession = new EndSession(control, permissions, id => liveGateway?.disposeSession(id), error => logger.warn({err:error}, "session permission cleanup deferred"));
  const expireSessions = new ExpireIdleSessions(control, endSession);
  const runtimeAgent = new AgentRuntime(agent);
  const runNextTurn = new RunNextTurn(control, runtimeAgent, channel, new ReplyChunker(), { ownerId, leaseMs: 10 * 60_000 }, telemetry, undefined, permissions, saveFiles, endSession, config.modelManagementEnabled ? models : undefined, taskManager);
  const deliverReply = new DeliverReply(control, channel, { ownerId, leaseMs: 60_000 }, undefined, telemetry);
  const recover = new RecoverInterruptedWork(control);
  const memoryGenerator = config.dryRun ? {
    extract: () => Promise.resolve({ content: "Dry-run session: no durable facts extracted.", shouldMerge: false }),
    merge: (overview: string) => Promise.resolve(overview),
  } : await PiMemoryGenerator.create({ runtime, models, gate, provider: storedSelection.providerId, modelId: piModelId, authPath: config.pi.authPath, modelsStorePath: config.pi.modelsStorePath });
  const memoryLoop = new MemoryWorkerLoop(memoryJobs, new GenerateSessionMemory(memoryJobs, memoryStore, memoryGenerator), logger);

  const pollLoop = new PollLoop({ accountId, channel, control, ingest, health, telemetry, logger });
  const turnLoop = new TurnWorkerLoop(runNextTurn, health, logger);
  const outboxLoop = new OutboxWorkerLoop(deliverReply, health, logger);
  health.beat("poll"); health.beat("turn"); health.beat("outbox");

  const admin = new AdminServer({
    taskRoutes: new TaskRoutes(taskManager, managementOwner, control),
    ...(config.modelManagementEnabled ? { modelRoutes: new ModelRoutes(models, authentication, managementOwner, () => modelSelections.events()) } : {}),
    host: config.adminHost,
    port: config.adminPort,
    control,
    channel,
    agent: runtimeAgent,
    health,
    telemetry,
    logger,
    memoryJobs,
  });
  let closed = false;
  let started = false;

  return {
    logger,
    accountId,
    async run(signal: AbortSignal): Promise<void> {
      if (signal.aborted) return;
      await admin.start();
      started = true;
      // main.ts owns the data-directory lock; binding the admin port also precedes recovery.
      endSession.all("recovery");
      memoryJobs.recover();
      logger.info({ recovered: recover.execute() }, "startup recovery complete");
      logger.info({ host: config.adminHost, port: config.adminPort, accountId }, "wechat pi agent started");
      const idle = new IdleSessionLoop(expireSessions);
      await runBackgroundLoops(signal, logger, [
        stop => pollLoop.run(stop),
        (stop, work) => turnLoop.run(stop, work),
        (stop, work) => outboxLoop.run(stop, work),
        (stop, work) => memoryLoop.run(stop, work),
        stop => idle.run(stop),
      ]);
    },
    async close(endSessions = true): Promise<void> {
      if (closed) return;
      closed = true;
      try { if (started && endSessions) endSession.all("shutdown"); }
      finally {
        await admin.close();
        await authentication.close();
        modelSelections.close();
        if (agent instanceof PiAgentGateway) agent.dispose();
        executor.close();
        memoryJobs.close();
        permissionStore.close();
        fileRepository.close();
        control.close();
        logger.info("wechat pi agent stopped");
      }
    },
  };
}

function resolvePermissionExecutorId(config: AppConfig): string {
  if (config.permissionExecutorId) return config.permissionExecutorId;
  const path = resolve(config.dataDir, "executor-id");
  try { writeFileSync(path, randomUUID(), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const id = readFileSync(path, "utf8").trim();
  if (!id) throw new Error("Permission executor ID is empty");
  return id;
}

async function resolveCredential(config: AppConfig, logger: Logger): Promise<ILinkCredential | undefined> {
  if (config.ilink.botToken && config.ilink.botId) {
    return {
      baseUrl: config.ilink.baseUrl,
      botToken: config.ilink.botToken,
      botId: config.ilink.botId,
      ...(config.ilink.userId ? { userId: config.ilink.userId } : {}),
    };
  }
  const store = new FileCredentialStore(config.credentialPath);
  const stored = await store.load();
  if (stored !== undefined) return stored;
  if (!process.stdout.isTTY) {
    throw new Error("iLink credential not found and startup is non-interactive. Run `npm run ilink:login` first.");
  }
  process.stdout.write("\n未检测到 iLink 登录，正在进入微信扫码授权...\n");
  const login = new ILinkQrLogin({ onStatus: (status) => logger.info({ status }, "iLink QR status") });
  const started = await login.start();
  process.stdout.write(`请使用微信扫描二维码：\n${started.qrcodeUrl}\n`);
  const credential = await login.waitForConfirmation(started);
  await store.save(credential);
  return credential;
}
