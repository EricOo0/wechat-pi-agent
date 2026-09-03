import { createCipheriv } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadILinkImage } from "../../../src/adapters/outbound/ilink/ilink-image-downloader.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("downloadILinkImage", () => {
  it("downloads, AES-decrypts, detects, and persists an iLink image", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ilink-image-"));
    directories.push(directory);
    const plaintext = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("test-image-data"),
    ]);
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(encrypted, { status: 200 })));

    const image = await downloadILinkImage({
      aeskey: key.toString("hex"),
      media: { full_url: "https://novac2c.cdn.weixin.qq.com/c2c/download?id=test" },
    }, {
      mediaDir: directory,
      cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
      fetch: fetchMock,
    });

    expect(image).toMatchObject({ mimeType: "image/png", bytes: plaintext.length });
    expect(await readFile(image.path)).toEqual(plaintext);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects non-Weixin CDN URLs", async () => {
    await expect(downloadILinkImage({
      media: { full_url: "https://example.com/image.png" },
    }, {
      mediaDir: "/tmp/unused",
      cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
      fetch,
    })).rejects.toThrow(/weixin\.qq\.com/);
  });
});
