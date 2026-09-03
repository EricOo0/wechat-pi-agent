import { createServer, type Server, type ServerResponse } from "node:http";
import type { Logger } from "pino";
import type { AgentPort } from "../../../application/ports/agent.port.js";
import type { ChannelPort } from "../../../application/ports/channel.port.js";
import type { ControlPlanePort } from "../../../application/ports/control-plane.port.js";
import type { PrometheusTelemetry } from "../../outbound/observability/metrics.js";
import type { RuntimeHealth } from "./runtime-health.js";
import { TRACE_PAGE_HTML } from "./trace-page.js";

export interface AdminServerOptions {
  host: string;
  port: number;
  control: ControlPlanePort;
  channel: ChannelPort;
  agent: AgentPort;
  health: RuntimeHealth;
  telemetry: PrometheusTelemetry;
  logger: Logger;
  workerMaxAgeMs?: number;
}

export class AdminServer {
  private readonly server: Server;

  public constructor(private readonly options: AdminServerOptions) {
    this.server = createServer((request, response) => {
      void this.handle(request.url ?? "/", response).catch((error: unknown) => {
        this.options.logger.error({ err: error }, "admin request failed");
        this.json(response, 500, { error: "internal_error" });
      });
    });
  }

  public async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port, this.options.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  public getPort(): number | undefined {
    const address = this.server.address();
    return address !== null && typeof address === "object" ? address.port : undefined;
  }

  public async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }

  private async handle(urlValue: string, response: ServerResponse): Promise<void> {
    const url = new URL(urlValue, `http://${this.options.host}:${this.options.port}`);
    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/admin" });
      response.end();
      return;
    }
    if (url.pathname === "/admin") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(TRACE_PAGE_HTML);
      return;
    }
    if (url.pathname === "/healthz") {
      this.json(response, 200, { status: "ok" });
      return;
    }
    if (url.pathname === "/readyz") {
      const reasons: string[] = [];
      const db = this.options.control.healthCheck();
      if (!db.ready) reasons.push(db.reason ?? "database_not_ready");
      const [channel, agent] = await Promise.all([this.options.channel.checkReady(), this.options.agent.checkReady()]);
      if (!channel.ready) reasons.push(channel.reason ?? "channel_not_ready");
      if (!agent.ready) reasons.push(agent.reason ?? "agent_not_ready");
      reasons.push(...this.options.health.staleWorkers(this.options.workerMaxAgeMs ?? 120_000).map((name) => `${name}_worker_stale`));
      this.json(response, reasons.length === 0 ? 200 : 503, { status: reasons.length === 0 ? "ready" : "not_ready", reasons });
      return;
    }
    if (url.pathname === "/metrics") {
      response.writeHead(200, { "Content-Type": this.options.telemetry.registry.contentType });
      response.end(await this.options.telemetry.metrics());
      return;
    }
    if (url.pathname === "/debug/traces") {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 100), 100));
      this.json(response, 200, this.options.control.getRecentAgentTraces(limit));
      return;
    }
    const traceMatch = /^\/debug\/traces\/([^/]+)$/.exec(url.pathname);
    if (traceMatch?.[1]) {
      const turnId = decodeURIComponent(traceMatch[1]);
      const trace = this.options.control.getAgentTrace(turnId);
      const details = this.options.control.getTurnDetails(turnId);
      this.json(response, trace === undefined ? 404 : 200, trace === undefined ? { error: "trace_not_found" } : { trace, details });
      return;
    }
    const turnMatch = /^\/debug\/turns\/([^/]+)$/.exec(url.pathname);
    if (turnMatch?.[1]) {
      const details = this.options.control.getTurnDetails(decodeURIComponent(turnMatch[1]));
      this.json(response, details === undefined ? 404 : 200, details ?? { error: "turn_not_found" });
      return;
    }
    if (url.pathname === "/debug/recent-errors") {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 20), 100));
      this.json(response, 200, this.options.control.getRecentErrors(limit));
      return;
    }
    this.json(response, 404, { error: "not_found" });
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent) return;
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }
}
