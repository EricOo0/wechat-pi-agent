export const ILinkMessageType = { USER: 1, BOT: 2 } as const;
export const ILinkMessageState = { NEW: 0, GENERATING: 1, FINISH: 2 } as const;
export const ILinkItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 } as const;

export interface ILinkTextItem {
  text?: string;
}

export interface ILinkCdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface ILinkImageItem {
  media?: ILinkCdnMedia;
  thumb_media?: ILinkCdnMedia;
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface ILinkMessageItem {
  type?: number;
  text_item?: ILinkTextItem;
  image_item?: ILinkImageItem;
  file_item?: { media?: ILinkCdnMedia; file_name?: string; len?: string; md5?: string };
}

export interface ILinkMessage {
  seq?: number;
  message_id?: number | string;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: ILinkMessageItem[];
  context_token?: string;
  run_id?: string;
}

export interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: ILinkMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageResponse {
  ret?: number;
  errmsg?: string;
}

export interface QrCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QrStatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect" | "need_verifycode" | "verify_code_blocked" | "binded_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

export interface ILinkCredential {
  baseUrl: string;
  botToken: string;
  botId: string;
  userId?: string;
}
