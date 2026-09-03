import { createCipheriv } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ILinkHttpClient } from "../../src/adapters/outbound/ilink/ilink-http-client.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ILinkHttpClient image updates", () => {
  it("maps an encrypted image-only update into a persisted inbound attachment", async () => {
    const mediaDir = await mkdtemp(join(tmpdir(), "ilink-update-image-"));
    directories.push(mediaDir);
    const plaintext = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.from("image-content"),
    ]);
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname.endsWith("/ilink/bot/getupdates")) {
        return Promise.resolve(new Response(JSON.stringify({
          ret: 0,
          get_updates_buf: "next",
          msgs: [{
            message_id: 99,
            from_user_id: "user-image",
            message_type: 1,
            item_list: [{
              type: 2,
              image_item: {
                aeskey: key.toString("hex"),
                media: { full_url: "https://novac2c.cdn.weixin.qq.com/c2c/download?id=image" },
              },
            }],
          }],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(encrypted, { status: 200 }));
    });
    const client = new ILinkHttpClient({
      baseUrl: "https://ilinkai.weixin.qq.com",
      botToken: "secret",
      mediaDir,
      fetch: fetchMock,
    });

    const batch = await client.getUpdates("bot", "cursor", new AbortController().signal);

    expect(batch.messages).toHaveLength(1);
    expect(batch.messages[0]).toMatchObject({
      channelMessageId: "99",
      text: "请分析用户发送的图片。",
      images: [expect.objectContaining({ mimeType: "image/jpeg", bytes: plaintext.length })],
    });
    const image = batch.messages[0]!.images?.[0];
    if (image === undefined) throw new Error("image was not mapped");
    expect(await readFile(image.path)).toEqual(plaintext);
    expect(JSON.stringify(batch.messages[0]!.raw)).not.toContain(key.toString("hex"));
    expect(JSON.stringify(batch.messages[0]!.raw)).not.toContain("full_url");
  });
});
