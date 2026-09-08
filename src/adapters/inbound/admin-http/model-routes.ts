import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ModelManagementError } from "../../../domain/models/model-selection.js";
import type { ModelManagement } from "../../../application/use-cases/select-model.js";
import type { PiProviderAuthentication } from "../../outbound/pi/pi-provider-authentication.js";
import { modelSettingsPage } from "./model-settings-page.js";
export class ModelRoutes {
  private readonly csrf = randomBytes(32).toString("hex");
  public constructor(private readonly models: ModelManagement, private readonly auth: PiProviderAuthentication,
    private readonly owner: string, private readonly audit: () => unknown[] = () => []) {}
  public async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/admin/models" && !path.startsWith("/admin/api/")) return false;
    const host = request.headers.host ?? "";
    const port = request.socket.localPort;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "");
    const origin = request.headers.origin;
    if (!local || !allowedHosts.includes(host) || (origin !== undefined && origin !== `http://${host}`) || request.headers["sec-fetch-site"] === "cross-site") { this.json(response, 403, { error: "仅允许本机同源访问" }); return true; }
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    if (path === "/admin/models" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; connect-src 'self'" }); response.end(modelSettingsPage(this.csrf)); return true;
    }
    const key = request.headers["x-local-control"];
    if (typeof key !== "string" || key.length !== this.csrf.length || !timingSafeEqual(Buffer.from(key), Buffer.from(this.csrf))) { this.json(response, 403, { error: "请从本机模型管理页发起操作" }); return true; }
    try {
      const method = request.method; const route = path.slice("/admin/api/".length);
      if (method === "GET") {
        if (route === "models") this.json(response, 200, { selection: this.models.current(this.owner), providers: this.models.catalog.listProviders() });
        else if (route.startsWith("models/")) this.json(response, 200, await this.models.catalog.listModels(decodeURIComponent(route.slice(7))));
        else if (route === "auth") this.json(response, 200, this.auth.list());
        else if (route.startsWith("auth/")) this.json(response, 200, this.auth.get(route.slice(5)) ?? null);
        else if (route === "events") this.json(response, 200, this.audit());
        else this.json(response, 404, { error: "not_found" });
        return true;
      }
      if (method !== "POST" && method !== "PUT") { this.json(response, 405, { error: "method_not_allowed" }); return true; }
      const body = await readBody(request);
      if (route === "selection" && method === "PUT") {
        const revision = body.expectedRevision;
        if (!Number.isSafeInteger(revision)) throw new Error("Invalid revision");
        this.json(response, 200, await this.models.select(this.owner, field(body, "providerId"), field(body, "modelId"), revision as number));
      } else if (route === "auth" && method === "POST") {
        if (body.action !== "login" && body.action !== "reauth") throw new Error("Invalid action");
        this.json(response, 200, await this.auth.start(field(body, "provider"), body.action));
      } else {
        const match = /^auth\/([a-zA-Z0-9-]+)\/(begin|input|cancel)$/.exec(route);
        if (!match || method !== "POST") { this.json(response, 404, { error: "not_found" }); return true; }
        if (match[2] === "begin") this.auth.begin(match[1]!, field(body, "method"));
        if (match[2] === "input") this.auth.submit(match[1]!, field(body, "promptId"), field(body, "value"));
        if (match[2] === "cancel") this.auth.cancel(match[1]!);
        this.json(response, 200, { ok: true });
      }
    } catch (error) { this.json(response, 400, { error: error instanceof ModelManagementError ? error.message : "请求未完成，请检查输入或本机配置。" }); }
    return true;
  }
  private json(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); }
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new Error("Expected JSON");
  let size = 0; const chunks: Buffer[] = [];
  for await (const value of request) { const chunk = Buffer.from(value as Uint8Array); size += chunk.length; if (size > 20_000) throw new Error("Body too large"); chunks.push(chunk); }
  const result: unknown = JSON.parse(Buffer.concat(chunks).toString());
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid body");
  return result as Record<string, unknown>;
}
function field(body: Record<string, unknown>, name: string): string { if (typeof body[name] !== "string" || !body[name].length) throw new Error("Missing field"); return body[name]; }
