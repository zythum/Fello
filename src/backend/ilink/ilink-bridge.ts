import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { FELLO_DIR } from "../storage";
import { decryptAesEcb, decodeAesKey, decodeAesKeyHex } from "./ilink-crypto";
import {
  ILinkClient,
  type ILinkCredentials,
  type ILinkCursor,
  type WeixinMessage,
  type GetUpdatesResponse,
  type ImageItem,
} from "./ilink-client";

// ── Types ───────────────────────────────────────────────────────────

export interface ILinkStatus {
  connected: boolean;
  userId?: string;
  accountId?: string;
  qrcodeUrl?: string;
  error?: string;
}

export type IlinkQrcodeState = "wait" | "scaned" | "confirmed" | "expired";

export type ILinkStatusCallback = (status: ILinkStatus) => void;
export type ILinkMessageCallback = (msg: WeixinMessage) => void;

const ILINK_DIR = join(FELLO_DIR, "ilink");
const CREDENTIALS_PATH = join(ILINK_DIR, "credentials.json");
const CURSOR_PATH = join(ILINK_DIR, "cursor.json");
const ACTIVE_SESSION_PATH = join(ILINK_DIR, "active-session.json");

// ── Helpers ─────────────────────────────────────────────────────────

async function ensureDir() {
  await mkdir(ILINK_DIR, { recursive: true });
}

async function readCredentials(): Promise<ILinkCredentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf-8");
    return JSON.parse(raw) as ILinkCredentials;
  } catch {
    return null;
  }
}

async function writeCredentials(creds: ILinkCredentials): Promise<void> {
  await ensureDir();
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

async function clearCredentials(): Promise<void> {
  try {
    await rm(CREDENTIALS_PATH, { force: true });
  } catch {}
}

async function readCursor(): Promise<ILinkCursor | null> {
  try {
    const raw = await readFile(CURSOR_PATH, "utf-8");
    return JSON.parse(raw) as ILinkCursor;
  } catch {
    return null;
  }
}

async function writeCursor(cursor: ILinkCursor): Promise<void> {
  await ensureDir();
  await writeFile(CURSOR_PATH, JSON.stringify(cursor, null, 2));
}

async function clearCursor(): Promise<void> {
  try {
    await rm(CURSOR_PATH, { force: true });
  } catch {}
}

export async function readActiveSessionId(): Promise<string | null> {
  try {
    const raw = await readFile(ACTIVE_SESSION_PATH, "utf-8");
    const data = JSON.parse(raw);
    return typeof data?.sessionId === "string" ? data.sessionId : null;
  } catch {
    return null;
  }
}

export async function writeActiveSessionId(sessionId: string | null): Promise<void> {
  await ensureDir();
  if (sessionId) {
    await writeFile(ACTIVE_SESSION_PATH, JSON.stringify({ sessionId }), { mode: 0o600 });
  } else {
    try {
      await rm(ACTIVE_SESSION_PATH, { force: true });
    } catch {}
  }
}

/**
 * Extract plain text from a WeixinMessage's item_list.
 */
export function extractMessageText(msg: WeixinMessage): string {
  if (!msg.item_list) return "";
  return msg.item_list
    .filter((item) => item.type === 1 && item.text_item?.text)
    .map((item) => item.text_item!.text!)
    .join("");
}

/**
 * Extract voice-to-text from a WeixinMessage's voice items.
 */
export function extractVoiceText(msg: WeixinMessage): string {
  if (!msg.item_list) return "";
  return msg.item_list
    .filter((item) => item.type === 3 && item.voice_item?.text)
    .map((item) => item.voice_item!.text!)
    .join("");
}

/**
 * Check if a WeixinMessage contains image items.
 */
export function hasImageItems(msg: WeixinMessage): boolean {
  if (!msg.item_list) return false;
  return msg.item_list.some((item) => item.type === 2 && item.image_item);
}

/**
 * Split long text for WeChat (2000 char limit per message).
 * Prefers splitting at \n\n, then \n, then space, then hard cut.
 */
export function splitLongText(text: string, maxLen = 2000): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitAt = maxLen;

    // Try to find a good split point, searching backwards
    const searchWindow = remaining.substring(0, maxLen);
    for (const sep of ["\n\n", "\n", "。", "！", "？", "，", " "]) {
      const idx = searchWindow.lastIndexOf(sep);
      if (idx > maxLen * 0.5 && idx < maxLen) {
        splitAt = idx + sep.length;
        break;
      }
    }

    chunks.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining.trim());
  }

  return chunks.filter((c) => c.length > 0);
}

// ── Bridge ──────────────────────────────────────────────────────────

export class ILinkBridge {
  private client: ILinkClient | null = null;
  private creds: ILinkCredentials | null = null;
  private cursor: ILinkCursor = { get_updates_buf: "" };
  private abortController: AbortController | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: ILinkStatus = { connected: false };
  private typingTicket: string | null = null;
  private contextTokenCache = new Map<string, string>();

  private onStatusChange: ILinkStatusCallback;
  private onMessage: ILinkMessageCallback;

  constructor(callbacks: { onStatusChange: ILinkStatusCallback; onMessage: ILinkMessageCallback }) {
    this.onStatusChange = callbacks.onStatusChange;
    this.onMessage = callbacks.onMessage;
  }

  get status(): ILinkStatus {
    return { ...this._status };
  }

  get isConnected(): boolean {
    return this._status.connected;
  }

  get userId(): string | undefined {
    return this.creds?.userId;
  }

  /**
   * Try to restore session from persisted credentials.
   * Returns true if successfully restored and connected.
   */
  async tryRestore(): Promise<boolean> {
    const creds = await readCredentials();
    if (!creds?.token) return false;

    const cursor = await readCursor();
    this.creds = creds;
    this.cursor = cursor ?? { get_updates_buf: "" };
    this.client = new ILinkClient(creds);

    this._status = {
      connected: true,
      userId: creds.userId,
      accountId: creds.accountId,
    };
    this.onStatusChange(this._status);

    // Start polling in background
    this.startPollLoop();
    return true;
  }

  /**
   * Start login flow: get QR code, return it for display.
   * Caller should then poll with checkQrcodeStatus().
   */
  async startLogin(): Promise<{ qrcode: string; qrcodeImgUrl: string }> {
    // Create a temporary client (no auth) just for login
    const tempClient = new ILinkClient({
      token: "",
      baseUrl: "https://ilinkai.weixin.qq.com",
      accountId: "",
      userId: "",
      savedAt: new Date().toISOString(),
    });

    const { qrcode, qrcode_img_content } = await tempClient.getBotQrcode();
    this._status = { connected: false, qrcodeUrl: qrcode_img_content };
    this.onStatusChange(this._status);

    return { qrcode, qrcodeImgUrl: qrcode_img_content };
  }

  /**
   * Poll QR code status until confirmed or expired.
   * Returns credentials on confirmed, null if still waiting.
   * Throws on expired.
   */
  async checkQrcodeStatus(qrcode: string): Promise<IlinkQrcodeState> {
    // If already connected, don't mess with status
    if (this._status.connected) return "confirmed";

    const tempClient = new ILinkClient({
      token: "",
      baseUrl: "https://ilinkai.weixin.qq.com",
      accountId: "",
      userId: "",
      savedAt: new Date().toISOString(),
    });

    const res = await tempClient.getQrcodeStatus(qrcode);

    if (res.status === "confirmed" && res.bot_token) {
      const creds: ILinkCredentials = {
        token: res.bot_token,
        baseUrl: res.baseurl || "https://ilinkai.weixin.qq.com",
        accountId: res.ilink_bot_id ?? "",
        userId: res.ilink_user_id ?? "",
        savedAt: new Date().toISOString(),
      };

      await writeCredentials(creds);
      this.creds = creds;
      this.cursor = { get_updates_buf: "" };
      this.client = new ILinkClient(creds);

      this._status = {
        connected: true,
        userId: creds.userId,
        accountId: creds.accountId,
      };
      this.onStatusChange(this._status);

      this.startPollLoop();
      return "confirmed";
    }

    if (res.status === "expired") {
      // Only update status if we're not yet connected (still in login phase)
      if (!this._status.connected) {
        this._status = { connected: false, error: "QR code expired" };
        this.onStatusChange(this._status);
      }
      return "expired";
    }

    // "wait" or "scaned" — still in progress
    if (res.status === "scaned") {
      if (!this._status.connected) {
        this._status = { connected: false, qrcodeUrl: this._status.qrcodeUrl };
        this.onStatusChange(this._status);
      }
    }

    return res.status;
  }

  /**
   * Stop the bridge and disconnect.
   */
  async stop(): Promise<void> {
    this.stopPollLoop();

    await clearCredentials();
    await clearCursor();

    this.client = null;
    this.creds = null;
    this.cursor = { get_updates_buf: "" };
    this.typingTicket = null;
    this.contextTokenCache.clear();

    this._status = { connected: false };
    this.onStatusChange(this._status);
  }

  /**
   * Send a text reply to a user via WeChat.
   * Automatically splits long messages.
   */
  async sendTextReply(toUserId: string, text: string): Promise<void> {
    if (!this.client || !this.creds) {
      throw new Error("iLink not connected");
    }

    const contextToken = this.contextTokenCache.get(toUserId);
    if (!contextToken) {
      // Cannot send without a context_token — this is an iLink protocol constraint
      console.warn("[iLink] No context_token for user, cannot send reply:", toUserId);
      return;
    }

    const chunks = splitLongText(text);

    for (const chunk of chunks) {
      await this.client.sendMessage({
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: `fello:${Date.now()}-${randomUUID().slice(0, 8)}`,
          message_type: 2, // BOT
          message_state: 2, // FINISH
          context_token: contextToken,
          item_list: [
            {
              type: 1, // TEXT
              text_item: { text: chunk },
            },
          ],
        },
        base_info: { channel_version: "0.1.0" },
      });
    }
  }

  /**
   * Download and decrypt an image from a WeixinMessage image_item.
   * Returns base64-encoded image data.
   */
  async downloadImage(
    imageItem: ImageItem,
    options: { useOriginalImage?: boolean } = {},
  ): Promise<string | null> {
    if (!this.client) return null;

    const useThumb = !options.useOriginalImage;
    let encryptQueryParam: string | undefined;
    let aesKeyRaw: string | undefined;

    if (useThumb && imageItem.thumb_media?.encrypt_query_param) {
      // Prefer thumb (smaller size, saves tokens)
      encryptQueryParam = imageItem.thumb_media.encrypt_query_param;
      aesKeyRaw = imageItem.thumb_media.aes_key;
    } else {
      // Fallback to full-size image
      encryptQueryParam = imageItem.media?.encrypt_query_param;
      aesKeyRaw = imageItem.media?.aes_key || imageItem.aeskey;
    }

    if (!encryptQueryParam) return null;

    const encrypted = await this.client.downloadFromCdn(encryptQueryParam);
    if (!aesKeyRaw) return encrypted.toString("base64");

    const key =
      aesKeyRaw.length <= 32 && /^[0-9a-fA-F]+$/.test(aesKeyRaw)
        ? decodeAesKeyHex(aesKeyRaw)
        : decodeAesKey(aesKeyRaw);
    const decrypted = decryptAesEcb(encrypted, key);
    return decrypted.toString("base64");
  }

  /**
   * Send typing indicator.
   */
  async sendTyping(userId: string, start: boolean): Promise<void> {
    if (!this.client || !this.creds) return;

    try {
      if (!this.typingTicket) {
        const contextToken = this.contextTokenCache.get(userId);
        const config = await this.client.getConfig({
          ilink_user_id: userId,
          context_token: contextToken,
          base_info: { channel_version: "0.1.0" },
        });
        if (config.typing_ticket) {
          this.typingTicket = config.typing_ticket;
        }
      }

      if (this.typingTicket) {
        await this.client.sendTyping({
          ilink_user_id: userId,
          typing_ticket: this.typingTicket,
          status: start ? 1 : 2,
          base_info: { channel_version: "0.1.0" },
        });
      }
    } catch (err) {
      console.warn("[iLink] sendTyping failed:", err);
      this.typingTicket = null; // Reset on failure
    }
  }

  /**
   * Get the context_token for a user (for external use).
   */
  getContextToken(userId: string): string | undefined {
    return this.contextTokenCache.get(userId);
  }

  // ── Private ──────────────────────────────────────────────────────

  private startPollLoop() {
    if (this.pollTimer) return;
    this.abortController = new AbortController();
    this.poll();
  }

  private stopPollLoop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.client || !this.creds || !this.abortController) return;

    // Current timer callback is now running; clear handle until next schedule.
    this.pollTimer = null;
    const signal = this.abortController.signal;

    try {
      const response: GetUpdatesResponse = await this.client.getUpdates(
        this.cursor.get_updates_buf,
        signal,
      );

      // Check for session expiration
      if (ILinkClient.isSessionExpired(response)) {
        console.warn("[iLink] Session expired, clearing state");
        this.stopPollLoop();
        await clearCredentials();
        await clearCursor();
        this.client = null;
        this.creds = null;
        this.cursor = { get_updates_buf: "" };
        this.contextTokenCache.clear();
        this.typingTicket = null;

        this._status = { connected: false, error: "Session expired — please re-login" };
        this.onStatusChange(this._status);
        return;
      }

      // Update cursor
      if (response.get_updates_buf) {
        this.cursor = { get_updates_buf: response.get_updates_buf };
        // Persist cursor (fire-and-forget)
        writeCursor(this.cursor).catch(() => {});
      }

      // Process messages
      if (response.msgs && response.msgs.length > 0) {
        for (const msg of response.msgs) {
          // Only process USER messages (message_type=1), ignore BOT echoes (message_type=2)
          if (msg.message_type !== 1) continue;

          // Cache context_token for future replies
          if (msg.context_token && msg.from_user_id) {
            this.contextTokenCache.set(msg.from_user_id, msg.context_token);
          }
          this.onMessage(msg);
        }
      }

      // Immediately start next long-poll (getupdates will hang until new message or timeout)
      this.pollTimer = setTimeout(() => this.poll(), 0);
    } catch (err: any) {
      if (err?.name === "AbortError") return;

      console.error("[iLink] Poll error:", err);
      // Retry after short delay
      this.pollTimer = setTimeout(() => this.poll(), 2000);
    }
  }
}
