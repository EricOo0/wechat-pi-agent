import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { Channel, PreparedImage } from "../../modules/messaging/index.js";
import type { InboundBatch, InboundMessage } from "../../modules/messaging/index.js";
import type { OutboundMessage } from "../../modules/messaging/index.js";
import { downloadILinkImage } from "./ilink-image-downloader.js";
import { ILinkItemType, ILinkMessageState, ILinkMessageType, type GetUpdatesResponse, type ILinkMessage, type SendMessageResponse } from "./protocol-types.js";

export interface ILinkHttpClientOptions {
  baseUrl: string;
  botToken: string;
  appId?: string;
  clientVersion?: number;
  botAgent?: string;
  longPollTimeoutMs?: number;
  requestTimeoutMs?: number;
  mediaDir: string;
  cdnBaseUrl?: string;
  onMediaError?: (error: Error) => void;
  fetch?: typeof globalThis.fetch;
}

export class ILinkProtocolError extends Error {
  public constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = "ILinkProtocolError";
  }
}

export class ILinkHttpClient implements Channel {
  private readonly fetchImpl: typeof globalThis.fetch;

  public constructor(private readonly options: ILinkHttpClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  public async getUpdates(accountId: string, cursor: string, signal: AbortSignal): Promise<InboundBatch> {
    const response = await this.post<GetUpdatesResponse>(
      "ilink/bot/getupdates",
      { get_updates_buf: cursor, base_info: this.baseInfo() },
      this.options.longPollTimeoutMs ?? 35_000,
      signal,
    );
    this.assertSuccess(response);
    const normalized = await Promise.all((response.msgs ?? []).map((message) => this.normalizeMessage(accountId, message, signal)));
    const messages = normalized.filter((message): message is InboundMessage => message !== undefined);
    return {
      accountId,
      previousCursor: cursor,
      nextCursor: response.get_updates_buf ?? cursor,
      messages,
    };
  }

  public async sendText(message: OutboundMessage, signal: AbortSignal): Promise<{ remoteRequestId?: string }> {
    const response = await this.post<SendMessageResponse>(
      "ilink/bot/sendmessage",
      {
        msg: {
          to_user_id: message.peerId,
          context_token: message.contextToken,
          client_id: message.clientId,
          run_id: message.runId,
          message_type: ILinkMessageType.BOT,
          message_state: ILinkMessageState.FINISH,
          item_list: [{ type: ILinkItemType.TEXT, text_item: { text: message.text } }],
        },
        base_info: this.baseInfo(),
      },
      this.options.requestTimeoutMs ?? 15_000,
      signal,
    );
    this.assertSuccess(response);
    return {};
  }

  public imageCredentialScope(): string {
    return createHash("sha256").update(JSON.stringify([this.options.baseUrl, this.options.botToken])).digest("hex");
  }

  public async prepareImage(
    message: OutboundMessage,
    image: { data: Buffer; mimeType: "image/png" | "image/jpeg" },
    signal: AbortSignal,
  ): Promise<PreparedImage> {
    signal.throwIfAborted();
    if (image.data.length === 0 || !["image/png", "image/jpeg"].includes(image.mimeType)) {
      throw new ILinkProtocolError("Unsupported or empty outbound image");
    }
    const key = randomBytes(16);
    const filekey = randomBytes(16).toString("hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const ciphertext = Buffer.concat([cipher.update(image.data), cipher.final()]);
    const upload = await this.post<{ ret?: number; errcode?: number; errmsg?: string; upload_full_url?: string; upload_param?: string }>(
      "ilink/bot/getuploadurl",
      {
        filekey, media_type: 1, to_user_id: message.peerId,
        rawsize: image.data.length, rawfilemd5: createHash("md5").update(image.data).digest("hex"),
        filesize: ciphertext.length, no_need_thumb: true, aeskey: key.toString("hex"),
        base_info: this.baseInfo(),
      },
      this.options.requestTimeoutMs ?? 15_000,
      signal,
    );
    this.assertImageSuccess(upload);
    const base = (this.options.cdnBaseUrl ?? "https://novac2c.cdn.weixin.qq.com/c2c").replace(/\/$/, "");
    const target = upload.upload_full_url?.trim() || (upload.upload_param
      ? `${base}/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param)}&filekey=${filekey}` : undefined);
    if (!target) throw new ILinkProtocolError("iLink returned no image upload URL");
    let url: URL;
    try { url = new URL(target); } catch { throw new ILinkProtocolError("iLink returned invalid image upload URL"); }
    if (url.protocol !== "https:" || url.username || url.password) throw new ILinkProtocolError("iLink image upload requires HTTPS");
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(ciphertext),
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.requestTimeoutMs ?? 15_000)]),
    });
    // CDN errors may contain signed URLs/keys; never persist their bodies in Outbox errors.
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new ILinkProtocolError(`iLink image upload HTTP ${response.status}`);
    }
    const encryptQueryParam = response.headers.get("x-encrypted-param");
    await response.body?.cancel();
    if (!encryptQueryParam) throw new ILinkProtocolError("iLink image upload missing encrypted media reference");
    return { encryptQueryParam, aesKey: Buffer.from(key.toString("hex"), "utf8").toString("base64"), ciphertextSize: ciphertext.length };
  }

  public async sendPreparedImage(message: OutboundMessage, image: PreparedImage, signal: AbortSignal): Promise<{ remoteRequestId?: string }> {
    const response = await this.post<SendMessageResponse>("ilink/bot/sendmessage", {
      msg: {
        to_user_id: message.peerId, context_token: message.contextToken,
        client_id: message.clientId, run_id: message.runId,
        message_type: ILinkMessageType.BOT, message_state: ILinkMessageState.FINISH,
        item_list: [{ type: ILinkItemType.IMAGE, image_item: {
          media: { encrypt_query_param: image.encryptQueryParam, aes_key: image.aesKey, encrypt_type: 1 },
          mid_size: image.ciphertextSize,
        } }],
      },
      base_info: this.baseInfo(),
    }, this.options.requestTimeoutMs ?? 15_000, signal);
    this.assertImageSuccess(response);
    return {};
  }

  public async sendImage(message: OutboundMessage, image: { data: Buffer; mimeType: "image/png" | "image/jpeg" }, signal: AbortSignal): Promise<{ remoteRequestId?: string }> {
    return this.sendPreparedImage(message, await this.prepareImage(message, image, signal), signal);
  }

  public async setTyping(accountId: string, peerId: string, active: boolean, signal: AbortSignal): Promise<void> {
    void accountId;
    const config = await this.post<{ ret?: number; errmsg?: string; typing_ticket?: string }>(
      "ilink/bot/getconfig",
      { ilink_user_id: peerId, base_info: this.baseInfo() },
      this.options.requestTimeoutMs ?? 10_000,
      signal,
    );
    this.assertSuccess(config);
    if (!config.typing_ticket) return;
    const response = await this.post<{ ret?: number; errmsg?: string }>(
      "ilink/bot/sendtyping",
      {
        ilink_user_id: peerId,
        typing_ticket: config.typing_ticket,
        status: active ? 1 : 2,
        base_info: this.baseInfo(),
      },
      this.options.requestTimeoutMs ?? 10_000,
      signal,
    );
    this.assertSuccess(response);
  }

  public checkReady(): Promise<{ ready: boolean; reason?: string }> {
    return Promise.resolve(this.options.botToken.trim().length > 0
      ? { ready: true }
      : { ready: false, reason: "ilink_not_authenticated" });
  }

  private async normalizeMessage(accountId: string, message: ILinkMessage, signal: AbortSignal): Promise<InboundMessage | undefined> {
    if (message.message_type !== ILinkMessageType.USER || !message.from_user_id) return undefined;
    const items = message.item_list ?? [];
    const text = items
      .filter((item) => item.type === ILinkItemType.TEXT)
      .map((item) => item.text_item?.text ?? "")
      .join("\n")
      .trim();
    const files = items.flatMap((item, itemIndex) => {
      if (item.type !== ILinkItemType.FILE) return [];
      const bytes = Number(item.file_item?.len);
      return [{ itemIndex, name: (typeof item.file_item?.file_name === "string" ? item.file_item.file_name : "未命名文件").slice(0, 255),
        ...(Number.isSafeInteger(bytes) && bytes >= 0 ? { declaredBytes: bytes } : {}),
        ...(item.file_item?.media === undefined ? {} : { media: item.file_item.media }) }];
    });
    const imageItems = items
      .filter((item) => item.type === ILinkItemType.IMAGE && item.image_item !== undefined)
      .slice(0, 4);
    const images = [];
    for (const item of imageItems) {
      try {
        images.push(await downloadILinkImage(item.image_item!, {
          mediaDir: this.options.mediaDir,
          cdnBaseUrl: this.options.cdnBaseUrl ?? "https://novac2c.cdn.weixin.qq.com/c2c",
          fetch: this.fetchImpl,
          signal,
        }));
      } catch (cause: unknown) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.options.onMediaError?.(error);
      }
    }
    if (!text && images.length === 0 && imageItems.length === 0 && files.length === 0) return undefined;
    const normalizedText = text || (files.length > 0 ? "" : images.length > 0
      ? "请分析用户发送的图片。"
      : "用户发送了一张图片，但图片内容下载失败。请提示用户稍后重试。");
    const receivedAt = new Date(message.create_time_ms ?? Date.now());
    const rawId = message.message_id?.toString() ?? `${message.from_user_id}:${message.seq ?? ""}:${message.create_time_ms ?? ""}:${normalizedText}:${imageItems.length}${files.length ? ":" + JSON.stringify(files.map(file => [file.name, file.declaredBytes])) : ""}`;
    const channelMessageId = message.message_id?.toString() ?? createHash("sha256").update(rawId).digest("hex");
    return {
      id: `msg_${channelMessageId}`,
      accountId,
      channelMessageId,
      peerId: message.from_user_id,
      senderId: message.from_user_id,
      ...(message.seq === undefined ? {} : { sequence: message.seq }),
      ...(message.context_token === undefined ? {} : { contextToken: message.context_token }),
      text: normalizedText,
      ...(images.length === 0 ? {} : { images }),
      ...(files.length === 0 ? {} : { files }),
      receivedAt,
      raw: this.redactRawMessage(message),
    };
  }

  private redactRawMessage(message: ILinkMessage): unknown {
    return {
      ...message,
      item_list: (message.item_list ?? []).map((item) => item.type === ILinkItemType.IMAGE
        ? {
            type: item.type,
            image_item: item.image_item === undefined ? undefined : {
              mid_size: item.image_item.mid_size,
              thumb_size: item.image_item.thumb_size,
              thumb_height: item.image_item.thumb_height,
              thumb_width: item.image_item.thumb_width,
              hd_size: item.image_item.hd_size,
              has_media: item.image_item.media !== undefined,
              has_thumb_media: item.image_item.thumb_media !== undefined,
            },
          }
        : item.type === ILinkItemType.FILE ? { type: item.type, file_item: { file_name: item.file_item?.file_name, len: item.file_item?.len } } : item),
    };
  }

  private async post<T>(endpoint: string, body: unknown, timeoutMs: number, externalSignal?: AbortSignal): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = externalSignal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, externalSignal]);
    const response = await this.fetchImpl(new URL(endpoint, this.ensureTrailingSlash(this.options.baseUrl)), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new ILinkProtocolError(`iLink HTTP ${response.status}`);
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new ILinkProtocolError("iLink returned invalid JSON");
    }
  }

  private assertImageSuccess(response: { ret?: number; errcode?: number }): void {
    if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
      // Signed media references must not flow into persisted worker errors.
      throw new ILinkProtocolError("iLink protocol error", response.errcode ?? response.ret);
    }
  }

  private assertSuccess(response: { ret?: number; errcode?: number; errmsg?: string }): void {
    if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
      throw new ILinkProtocolError(response.errmsg ?? "iLink protocol error", response.errcode ?? response.ret);
    }
  }

  private headers(): Record<string, string> {
    const uin = Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
    return {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${this.options.botToken}`,
      "X-WECHAT-UIN": uin,
      "iLink-App-Id": this.options.appId ?? "bot",
      "iLink-App-ClientVersion": String(this.options.clientVersion ?? 0x00020406),
    };
  }

  private baseInfo(): { channel_version: string; bot_agent: string } {
    return { channel_version: "0.1.0", bot_agent: this.options.botAgent ?? "WeChatPiAgent/0.1.0" };
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
  }
}
