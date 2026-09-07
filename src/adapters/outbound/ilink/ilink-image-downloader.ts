import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InboundImage } from "../../../domain/messaging/inbound-message.js";
import type { ILinkImageItem } from "./protocol-types.js";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;

export interface ILinkImageDownloadOptions {
  mediaDir: string;
  cdnBaseUrl: string;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}

export async function downloadILinkImage(image: ILinkImageItem, options: ILinkImageDownloadOptions): Promise<InboundImage> {
  const media = image.media ?? image.thumb_media;
  if (media === undefined || (!media.full_url && !media.encrypt_query_param)) {
    throw new Error("iLink image has no downloadable CDN media reference");
  }
  const url = media.full_url
    ? new URL(media.full_url)
    : new URL(`download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param ?? "")}`, ensureTrailingSlash(options.cdnBaseUrl));
  validateCdnUrl(url);
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
  const response = await options.fetch(url, { method: "GET", redirect: "error", signal });
  if (!response.ok) throw new Error(`iLink image CDN download failed with HTTP ${response.status}`);
  const encrypted = await readLimitedBody(response, MAX_IMAGE_BYTES + 16);
  const decrypted = decryptIfNeeded(encrypted, image.aeskey, media.aes_key);
  if (decrypted.length > MAX_IMAGE_BYTES) throw new Error(`iLink image exceeds ${MAX_IMAGE_BYTES} byte limit`);
  const detected = detectImage(decrypted);
  if (detected === undefined) throw new Error("iLink media is not a supported JPEG, PNG, GIF, or WebP image");

  await mkdir(options.mediaDir, { recursive: true, mode: 0o700 });
  const digest = createHash("sha256").update(decrypted).digest("hex");
  const path = join(options.mediaDir, `${digest}${detected.extension}`);
  const temporary = join(options.mediaDir, `.${digest}.${randomUUID()}.tmp`);
  await writeFile(temporary, decrypted, { mode: 0o600 });
  await chmod(temporary, 0o600);
  try {
    await rename(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return { path, mimeType: detected.mimeType, bytes: decrypted.length };
}

export function decryptIfNeeded(encrypted: Buffer, itemHexKey?: string, mediaBase64Key?: string): Buffer {
  if (!itemHexKey && !mediaBase64Key) return encrypted;
  const key = itemHexKey ? parseHexKey(itemHexKey) : parseBase64Key(mediaBase64Key!);
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function parseHexKey(value: string): Buffer {
  if (!/^[0-9a-fA-F]{32}$/u.test(value)) throw new Error("iLink image aeskey must contain 32 hexadecimal characters");
  return Buffer.from(value, "hex");
}

function parseBase64Key(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/u.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error("iLink image media.aes_key must decode to a 16-byte AES key");
}

function detectImage(data: Buffer): { mimeType: InboundImage["mimeType"]; extension: string } | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: ".png" };
  }
  if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) {
    return { mimeType: "image/gif", extension: ".gif" };
  }
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", extension: ".webp" };
  }
  return undefined;
}

export async function readLimitedBody(response: Response, limit: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error(`iLink image download exceeds ${limit} byte limit`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read() as { done: boolean; value?: Uint8Array };
      if (result.done) break;
      if (result.value === undefined) continue;
      total += result.value.byteLength;
      if (total > limit) throw new Error(`iLink image download exceeds ${limit} byte limit`);
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export function validateCdnUrl(url: URL): void {
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (url.protocol !== "https:" || !(hostname === "weixin.qq.com" || hostname.endsWith(".weixin.qq.com"))) {
    throw new Error("iLink image CDN URL must use HTTPS on a weixin.qq.com host");
  }
  if (url.username || url.password) throw new Error("iLink image CDN URL must not contain credentials");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
