import { copyFile, mkdir } from "node:fs/promises";
const destination = new URL("../dist/adapters/outbound/sandbox/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const file of ["supervisor.mjs", "tool-worker.mjs"]) {
  await copyFile(new URL(`../src/adapters/outbound/sandbox/${file}`, import.meta.url), new URL(file, destination));
}
