import { randomBytes } from "crypto";

/**
 * WeChat iLink Bot API — low-level HTTP client.
 *
 * Protocol reference: https://github.com/epiral/weixin-bot/blob/main/docs/protocol-spec.md
 * Base URL: https://ilinkai.weixin.qq.com
 * CDN URL:  https://novac2c.cdn.weixin.qq.com/c2c
 */

// ── Types ───────────────────────────────────────────────────────────

export interface QrcodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export type QrcodeStatus = "wait" | "scaned" | "confirmed" | "expired";

export interface QrcodeStatusResponse {
  status: QrcodeStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
}

export interface ILinkCredentials {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string;
  savedAt: string;
}

export interface ILinkCursor {
  get_updates_buf: string;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number; // 1=USER, 2=BOT
  message_state?: number; // 0=NEW, 1=GENERATING, 2=FINISH
  item_list?: MessageItem[];
  context_token?: string;
}

export interface MessageItem {
  type?: number; // 1=TEXT, 2=IMAGE, 3=VOICE, 4=FILE, 5=VIDEO
  text_item?: { text?: string };
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  encode_type?: number;
  bits_per_sample?: number;
  sample_rate?: number;
  playtime?: number;
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

export interface GetUpdatesRequest {
  get_updates_buf: string;
  base_info: { channel_version: string };
}

export interface GetUpdatesResponse {
  ret: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageRequest {
  msg: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: number;
    message_state: number;
    context_token: string;
    item_list: MessageItem[];
  };
  base_info: { channel_version: string };
}

export interface GetUploadUrlRequest {
  filekey: string;
  media_type: number; // 1=IMAGE, 2=VIDEO, 3=FILE, 4=VOICE
  to_user_id: string;
  rawsize: number;
  rawfilemd5: string;
  filesize: number;
  no_need_thumb?: boolean;
  aeskey?: string;
  base_info: { channel_version: string };
}

export interface GetUploadUrlResponse {
  upload_param: string;
  thumb_upload_param?: string;
}

export interface GetConfigRequest {
  ilink_user_id: string;
  context_token?: string;
  base_info: { channel_version: string };
}

export interface GetConfigResponse {
  ret: number;
  typing_ticket?: string;
}

export interface SendTypingRequest {
  ilink_user_id: string;
  typing_ticket: string;
  status: number; // 1=start, 2=cancel
  base_info: { channel_version: string };
}

export interface SendTypingResponse {
  ret: number;
}

// ── Client ──────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_CDN_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const CHANNEL_VERSION = "0.1.0";

/**
 * Generate X-WECHAT-UIN header value:
 *   random uint32 → decimal string → base64
 */
function generateWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf-8").toString("base64");
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "X-WECHAT-UIN": generateWechatUin(),
  };
}

async function handleHttpError(response: Response, context: string): Promise<never> {
  let body = "";
  try {
    body = await response.text();
  } catch {}
  throw new Error(
    `[iLink] ${context}: HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
  );
}

export class ILinkClient {
  private baseUrl: string;
  private cdnUrl: string;
  private token: string;

  constructor(credentials: ILinkCredentials) {
    this.baseUrl = credentials.baseUrl || DEFAULT_BASE_URL;
    this.cdnUrl = DEFAULT_CDN_URL;
    this.token = credentials.token;
  }

  // ── Auth ────────────────────────────────────────────────────────

  /** Step 1: Get a login QR code */
  async getBotQrcode(botType = 3): Promise<QrcodeResponse> {
    const url = `${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=${botType}`;
    const res = await fetch(url);
    if (!res.ok) await handleHttpError(res, "getBotQrcode");
    return res.json() as Promise<QrcodeResponse>;
  }

  /** Step 2: Poll QR code scan status */
  async getQrcodeStatus(qrcode: string): Promise<QrcodeStatusResponse> {
    const url = `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    const res = await fetch(url, {
      headers: { "iLink-App-ClientVersion": "1" },
    });
    if (!res.ok) await handleHttpError(res, "getQrcodeStatus");
    return res.json() as Promise<QrcodeStatusResponse>;
  }

  // ── Messaging ───────────────────────────────────────────────────

  /** Long-poll for new messages */
  async getUpdates(buf: string, signal?: AbortSignal): Promise<GetUpdatesResponse> {
    const body: GetUpdatesRequest = {
      get_updates_buf: buf,
      base_info: { channel_version: CHANNEL_VERSION },
    };
    const res = await fetch(`${this.baseUrl}/ilink/bot/getupdates`, {
      method: "POST",
      headers: authHeaders(this.token),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) await handleHttpError(res, "getUpdates");
    return res.json() as Promise<GetUpdatesResponse>;
  }

  /** Send a text or media message */
  async sendMessage(req: SendMessageRequest): Promise<void> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
      method: "POST",
      headers: authHeaders(this.token),
      body: JSON.stringify(req),
    });
    if (!res.ok) await handleHttpError(res, "sendMessage");
    // Parse response to check for session errors
    const body = (await res.json().catch(() => ({}))) as {
      ret?: number | null | undefined;
      errmsg?: string;
    };
    if (body.ret != null && body.ret !== 0) {
      throw new Error(`sendMessage failed: ret=${body.ret} errmsg=${body.errmsg || ""}`);
    }
  }

  /** Get config (including typing_ticket) */
  async getConfig(req: GetConfigRequest): Promise<GetConfigResponse> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/getconfig`, {
      method: "POST",
      headers: authHeaders(this.token),
      body: JSON.stringify(req),
    });
    if (!res.ok) await handleHttpError(res, "getConfig");
    return res.json() as Promise<GetConfigResponse>;
  }

  /** Send typing indicator */
  async sendTyping(req: SendTypingRequest): Promise<SendTypingResponse> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/sendtyping`, {
      method: "POST",
      headers: authHeaders(this.token),
      body: JSON.stringify(req),
    });
    if (!res.ok) await handleHttpError(res, "sendTyping");
    return res.json() as Promise<SendTypingResponse>;
  }

  // ── CDN Media ───────────────────────────────────────────────────

  /** Request CDN upload parameters */
  async getUploadUrl(req: GetUploadUrlRequest): Promise<GetUploadUrlResponse> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/getuploadurl`, {
      method: "POST",
      headers: authHeaders(this.token),
      body: JSON.stringify(req),
    });
    if (!res.ok) await handleHttpError(res, "getUploadUrl");
    return res.json() as Promise<GetUploadUrlResponse>;
  }

  /** Upload encrypted file to CDN. Returns the x-encrypted-param header value. */
  async uploadToCdn(uploadParam: string, filekey: string, ciphertext: Buffer): Promise<string> {
    const url = `${this.cdnUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(ciphertext),
    });
    if (!res.ok) await handleHttpError(res, "uploadToCdn");
    return res.headers.get("x-encrypted-param") ?? "";
  }

  /** Download encrypted file from CDN */
  async downloadFromCdn(encryptQueryParam: string): Promise<Buffer> {
    const url = `${this.cdnUrl}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
    const res = await fetch(url);
    if (!res.ok) await handleHttpError(res, "downloadFromCdn");
    return Buffer.from(await res.arrayBuffer());
  }

  /** Check if response indicates session expired */
  static isSessionExpired(response: GetUpdatesResponse): boolean {
    return response.ret === -14 || response.errcode === -14;
  }

  /** Check if response is successful */
  static isSuccess(response: GetUpdatesResponse): boolean {
    return response.ret === 0;
  }
}
