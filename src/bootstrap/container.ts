import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { AgentPort } from "../application/ports/agent.port.js";
import type { ChannelPort } from "../application/ports/channel.port.js";
import { OutboxWorkerLoop } from "../application/use-cases/outbox-worker-loop.js";
import { TurnWorkerLoop } from "../application/use-cases/turn-worker-loop.js";
import { DeliverReply } from "../application/use-cases/deliver-reply.js";
import { IngestMessage } from "../application/use-cases/ingest-message.js";
import { RecoverInterruptedWork } from "../application/use-cases/recover-interrupted-work.js";
import { RunNextTurn } from "../application/use-cases/run-next-turn.js";
import { ReplyChunker } from "../application/services/reply-chunker.js";
import { AdminServer } from "../adapters/inbound/admin-http/server.js";
import { RuntimeHealth } from "../adapters/inbound/admin-http/runtime-health.js";
import { PollLoop } from "../adapters/inbound/ilink/poll-loop.js";
import { DryRunChannel } from "../adapters/outbound/ilink/dry-run-channel.js";
import { FileCredentialStore } from "../adapters/outbound/ilink/file-credential-store.js";
import { ILinkHttpClient } from "../adapters/outbound/ilink/ilink-http-client.js";
import { ILinkQrLogin } from "../adapters/outbound/ilink/qr-login.js";
import type { ILinkCredential } from "../adapters/outbound/ilink/protocol-types.js";
import { PrometheusTelemetry } from "../adapters/outbound/observability/metrics.js";
import { createLogger } from "../adapters/outbound/observability/logger.js";
import { DryRunAgent } from "../adapters/outbound/pi/dry-run-agent.js";
import { PiAgentGateway } from "../adapters/outbound/pi/pi-agent-gateway.js";
import { SqliteControlPlane } from "../adapters/outbound/sqlite/index.js";
import { AllowAllSendersPolicy, ExactSenderPolicy } from "../domain/policy/sender-policy.js";
import type { AppConfig } from "./config.js";
import { resolvePiModelId } from "./pi-onboarding.js";

export interface AppRuntime {
  run(signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
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
  const channel: ChannelPort = config.dryRun
    ? new DryRunChannel()
    : new ILinkHttpClient({
        baseUrl: credential?.baseUrl ?? config.ilink.baseUrl,
        cdnBaseUrl: config.ilink.cdnBaseUrl,
        botToken: credential?.botToken ?? config.ilink.botToken,
        mediaDir: config.inboundMediaDir,
        onMediaError: (error) => logger.warn({ err: error }, "iLink image download failed"),
      });
  const piModelId = config.dryRun ? "" : await resolvePiModelId({
    provider: config.pi.provider,
    configuredModelId: config.pi.modelId,
    authPath: config.pi.authPath,
    modelsStorePath: config.pi.modelsStorePath,
    settingsPath: config.settingsPath,
    logger,
  });
  const agent: AgentPort = config.dryRun
    ? new DryRunAgent()
    : await PiAgentGateway.create({
        cwd: config.workspaceRoot,
        provider: config.pi.provider,
        modelId: piModelId,
        thinkingLevel: config.pi.thinkingLevel,
        authPath: config.pi.authPath,
        modelsStorePath: config.pi.modelsStorePath,
        sessionDir: config.piSessionDir,
        systemPromptPath: config.systemPromptPath,
        loadLocalSkills: config.pi.loadLocalSkills,
        toolSandboxRoot: config.tools.sandboxRoot,
        httpToolEnabled: config.tools.httpEnabled,
        httpAllowedHosts: config.tools.httpAllowedHosts,
        shellToolEnabled: config.tools.shellEnabled,
      });

  const senderPolicy = config.dryRun ? new AllowAllSendersPolicy() : new ExactSenderPolicy(allowedSender);
  const ingest = new IngestMessage(control, senderPolicy, telemetry);
  const ownerId = `worker_${randomUUID()}`;
  const runNextTurn = new RunNextTurn(control, agent, channel, new ReplyChunker(), { ownerId, leaseMs: 10 * 60_000 }, telemetry);
  const deliverReply = new DeliverReply(control, channel, { ownerId, leaseMs: 60_000 }, undefined, telemetry);
  const recover = new RecoverInterruptedWork(control);
  const recovered = recover.execute();
  logger.info({ recovered }, "startup recovery complete");

  const pollLoop = new PollLoop({ accountId, channel, control, ingest, health, telemetry, logger });
  const turnLoop = new TurnWorkerLoop(runNextTurn, health, logger);
  const outboxLoop = new OutboxWorkerLoop(deliverReply, health, logger);
  health.beat("poll"); health.beat("turn"); health.beat("outbox");

  const admin = new AdminServer({
    host: config.adminHost,
    port: config.adminPort,
    control,
    channel,
    agent,
    health,
    telemetry,
    logger,
  });
  let closed = false;

  return {
    logger,
    accountId,
    async run(signal: AbortSignal): Promise<void> {
      await admin.start();
      logger.info({ host: config.adminHost, port: config.adminPort, accountId }, "wechat pi agent started");
      await Promise.all([pollLoop.run(signal), turnLoop.run(signal), outboxLoop.run(signal)]);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await admin.close();
      if (agent instanceof PiAgentGateway) agent.dispose();
      control.close();
      logger.info("wechat pi agent stopped");
    },
  };
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
