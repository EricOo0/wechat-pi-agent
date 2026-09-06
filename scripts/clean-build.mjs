import { rm } from "node:fs/promises";
// dist is generated output; cleaning removes retired tool implementations too.
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
