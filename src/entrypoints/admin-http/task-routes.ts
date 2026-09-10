import type { IncomingMessage, ServerResponse } from "node:http";
import { taskTrace, type TaskManager } from "../../modules/tasks/index.js";
import type { TraceQuery } from "../../modules/observability/index.js";
import { TASK_PAGE_HTML } from "./task-page.js";
function escape(value: string): string { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
export class TaskRoutes {
  public constructor(private readonly tasks: TaskManager, private readonly owner: string, private readonly query?: TraceQuery) {}
  public handle(request: IncomingMessage, response: ServerResponse): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method !== 'GET' || (url.pathname !== '/admin/tasks' && url.pathname !== '/admin' && !/^\/debug\/tasks(?:\/[^/]+(?:\/trace)?)?$/.test(url.pathname))) return false;
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/admin/tasks' || url.pathname === '/admin') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      response.end(TASK_PAGE_HTML.replace('<!-- initial -->', '<noscript>' + this.tasks.list(this.owner).map(task => escape(task.goal)).join(' · ') + '</noscript>')); return true;
    }
    const id = url.pathname.split('/')[3];
    const data = id ? url.pathname.endsWith("/trace") && this.query ? taskTrace(this.tasks, this.query, decodeURIComponent(id), this.owner) : this.tasks.details(decodeURIComponent(id), this.owner) : this.tasks.list(this.owner);
    response.writeHead(data ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data ?? { error: 'not_found' })); return true;
  }
}
