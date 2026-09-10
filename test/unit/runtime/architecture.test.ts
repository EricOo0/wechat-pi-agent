import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rejects private cross-module access and IO in a domain while allowing public ports", () => {
  const root = mkdtempSync(join(tmpdir(), "architecture-"));
  const file = join(root, "src/modules/a/domain/a.ts");
  mkdirSync(join(root, "src/modules/a/domain"), { recursive: true });
  const check = () => spawnSync(process.execPath, [resolve("scripts/check-architecture.mjs"), root], { encoding: "utf8" });
  try {
    writeFileSync(file, 'import { X } from "../../b/index.js";');
    expect(check().status).toBe(0);
    writeFileSync(file, 'import { X } from "../../b/application/private.js";');
    expect(check().status).toBe(1);
    writeFileSync(file, 'import { readFile } from "node:fs/promises";');
    expect(check().status).toBe(1);
    writeFileSync(file, 'import { X } from "../../../adapters/sqlite/x.js";');
    expect(check().status).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
