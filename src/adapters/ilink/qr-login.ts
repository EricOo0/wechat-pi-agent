import type { ILinkCredential, QrCodeResponse, QrStatusResponse } from "./protocol-types.js";

export interface ILinkQrLoginOptions {
  baseUrl?: string;
  botType?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  onStatus?: (status: QrStatusResponse["status"]) => void;
}

export interface StartedQrLogin {
  qrcode: string;
  qrcodeUrl: string;
}

export class ILinkQrLogin {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  public constructor(private readonly options: ILinkQrLoginOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://ilinkai.weixin.qq.com";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  public async start(signal?: AbortSignal): Promise<StartedQrLogin> {
    const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(this.options.botType ?? "3")}`, this.trailing(this.baseUrl));
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "iLink-App-Id": "bot", "iLink-App-ClientVersion": String(0x00020406) },
      body: JSON.stringify({ local_token_list: [] }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new Error(`iLink QR HTTP ${response.status}`);
    const body = await response.json() as QrCodeResponse;
    if (!body.qrcode || !body.qrcode_img_content) throw new Error("iLink QR response is incomplete");
    return { qrcode: body.qrcode, qrcodeUrl: body.qrcode_img_content };
  }

  public async waitForConfirmation(login: StartedQrLogin, signal?: AbortSignal): Promise<ILinkCredential> {
    const deadline = Date.now() + (this.options.timeoutMs ?? 480_000);
    let pollingBase = this.baseUrl;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(login.qrcode)}`, this.trailing(pollingBase));
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { "iLink-App-Id": "bot", "iLink-App-ClientVersion": String(0x00020406) },
        signal: signal === undefined ? AbortSignal.timeout(35_000) : AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
      });
      if (!response.ok) throw new Error(`iLink QR status HTTP ${response.status}`);
      const body = await response.json() as QrStatusResponse;
      this.options.onStatus?.(body.status);
      if (body.status === "confirmed") {
        if (!body.bot_token || !body.ilink_bot_id) throw new Error("iLink login confirmed without credentials");
        return {
          baseUrl: body.baseurl ?? pollingBase,
          botToken: body.bot_token,
          botId: body.ilink_bot_id,
          ...(body.ilink_user_id === undefined ? {} : { userId: body.ilink_user_id }),
        };
      }
      if (body.status === "scaned_but_redirect" && body.redirect_host) pollingBase = `https://${body.redirect_host}`;
      if (body.status === "expired" || body.status === "verify_code_blocked") throw new Error(`iLink QR login ${body.status}`);
      if (body.status === "need_verifycode") throw new Error("iLink QR login requires a verify code; rerun with preconfigured credentials");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("iLink QR login timed out");
  }

  private trailing(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
  }
}
