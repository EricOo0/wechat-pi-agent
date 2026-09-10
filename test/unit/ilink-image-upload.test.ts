import { createDecipheriv, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ILinkHttpClient } from "../../src/adapters/ilink/ilink-http-client.js";
import type { OutboundMessage } from "../../src/modules/messaging/index.js";

const message: OutboundMessage = { id: "out", turnId: "turn", accountId: "bot", peerId: "peer", contextToken: "ctx", chunkIndex: 0, text: "", clientId: "stable-client", runId: "stable-run" };
const image = { data: Buffer.from("sixteen bytes!!!"), mimeType: "image/png" as const };
const signal = new AbortController().signal;
function setup(responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(responses.shift()!));
  return { fetch, client: new ILinkHttpClient({ baseUrl: "https://api.example/", botToken: "private-token", mediaDir: "/tmp/media", fetch }) };
}
const json = (value: unknown) => new Response(JSON.stringify(value));

describe("iLink outbound images", () => {
  it("encrypts upload, uses CDN returned reference, and preserves stable message identity", async () => {
    const { client, fetch } = setup([json({ upload_param: "signed/=param" }), new Response(null, { headers: { "x-encrypted-param": "download-param" } }), json({ ret: 0 })]);
    await client.sendImage(message, image, signal);
    const upload = JSON.parse(fetch.mock.calls[0]![1]!.body as string) as { aeskey: string; filekey: string };
    expect(upload).toMatchObject({ media_type: 1, to_user_id: "peer", rawsize: image.data.length, rawfilemd5: createHash("md5").update(image.data).digest("hex"), filesize: 32, no_need_thumb: true });
    const cdn = fetch.mock.calls[1]!;
    expect((cdn[0] as URL).href).toBe(`https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=signed%2F%3Dparam&filekey=${upload.filekey}`);
    expect(cdn[1]!.method).toBe("POST");
    expect(cdn[1]!.headers).toEqual({ "Content-Type": "application/octet-stream" });
    const decipher = createDecipheriv("aes-128-ecb", Buffer.from(upload.aeskey, "hex"), null);
    expect(Buffer.concat([decipher.update(Buffer.from(cdn[1]!.body as Uint8Array)), decipher.final()])).toEqual(image.data);
    const sent = JSON.parse(fetch.mock.calls[2]![1]!.body as string) as unknown;
    expect(sent).toMatchObject({ msg: { to_user_id: "peer", context_token: "ctx", client_id: "stable-client", run_id: "stable-run", message_type: 2, message_state: 2, item_list: [{ type: 2, image_item: { media: { encrypt_query_param: "download-param", aes_key: Buffer.from(upload.aeskey).toString("base64"), encrypt_type: 1 }, mid_size: 32 } }] } });
  });

  it("prefers full URL and reuses prepared media without uploading again", async () => {
    const { client, fetch } = setup([json({ upload_full_url: "https://cdn.example/signed", upload_param: "unused" }), new Response(null, { headers: { "x-encrypted-param": "download" } }), json({ ret: 0 }), json({ ret: 0 })]);
    const prepared = await client.prepareImage(message, image, signal);
    await client.sendPreparedImage(message, prepared, signal);
    await client.sendPreparedImage(message, prepared, signal);
    expect((fetch.mock.calls[1]![0] as URL).href).toBe("https://cdn.example/signed");
    expect(fetch.mock.calls.map(call => (call[0] as URL).pathname)).toEqual(["/ilink/bot/getuploadurl", "/signed", "/ilink/bot/sendmessage", "/ilink/bot/sendmessage"]);
  });

  it.each([
    [json({ ret: 7 }), "iLink protocol error"],
    [json({}), "no image upload URL"],
    [json({ upload_full_url: "http://cdn.example/file" }), "requires HTTPS"],
  ])("does not send on preparation error", async (response, error) => {
    const { client, fetch } = setup([response]);
    await expect(client.sendImage(message, image, signal)).rejects.toThrow(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new Response("secret-body", { status: 403 }), "iLink image upload HTTP 403"],
    [new Response(), "missing encrypted media reference"],
  ])("does not send after CDN failure or expose response body", async (response, error) => {
    const { client, fetch } = setup([json({ upload_param: "signed" }), response]);
    await expect(client.sendImage(message, image, signal)).rejects.toThrow(error);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sanitizes image API failures while retaining the numeric code", async () => {
    const { client } = setup([json({ ret: 8, errmsg: "secret-media-reference" })]);
    await expect(client.sendPreparedImage(message, { encryptQueryParam: "secret", aesKey: "secret-key", ciphertextSize: 32 }, signal))
      .rejects.toMatchObject({ message: "iLink protocol error", code: 8 });
  });

  it("aborts before any upload and changes scope when credentials change", async () => {
    const { client, fetch } = setup([]);
    await expect(client.sendImage(message, image, AbortSignal.abort())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const other = new ILinkHttpClient({ baseUrl: "https://api.example/", botToken: "rotated", mediaDir: "/tmp/media" });
    expect(client.imageCredentialScope()).not.toBe(other.imageCredentialScope());
    expect(client.imageCredentialScope()).toMatch(/^[a-f0-9]{64}$/);
  });
});
