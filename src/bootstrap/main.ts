import { loadEnvFile } from "node:process";
import { buildApp } from "./container.js";
import { loadConfig } from "./config.js";

try {
  loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const config = loadConfig();
const app = await buildApp(config);
const controller = new AbortController();
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  app.logger.info({ signal }, "shutdown requested");
  controller.abort();
}

process.once("SIGINT", () => { shutdown("SIGINT"); });
process.once("SIGTERM", () => { shutdown("SIGTERM"); });

try {
  await app.run(controller.signal);
} catch (error) {
  app.logger.fatal({ err: error }, "application failed");
  process.exitCode = 1;
} finally {
  await app.close();
}
