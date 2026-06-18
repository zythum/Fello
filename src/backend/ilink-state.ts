import type { ILinkBridge } from "./ilink/ilink-bridge";
import { isImageMimeType } from "../shared/constants";

// ── Types ────────────────────────────────────────────────────────────

export { isImageMimeType };

export interface IlinkMediaEntry {
  /** 已保存到本地的文件的绝对路径 */
  filePath: string;
  /** 原始文件名 */
  name: string;
  toUserId: string;
  /** MIME type, used to decide image vs file sending */
  mimeType?: string;
}

// ── Mutable State ────────────────────────────────────────────────────

let ilinkBridge: ILinkBridge | null = null;
let ilinkActiveSessionId: string | null = null;
let ilinkReplyBuffer = "";
let ilinkMediaBuffer: IlinkMediaEntry[] = [];
let iLinkCommandPending: ((input: string) => void) | null = null;

// ── Getters ──────────────────────────────────────────────────────────

export function getIlinkBridge(): ILinkBridge | null {
  return ilinkBridge;
}

export function getIlinkActiveSessionId(): string | null {
  return ilinkActiveSessionId;
}

export function getIlinkReplyBuffer(): string {
  return ilinkReplyBuffer;
}

export function getIlinkMediaBuffer(): IlinkMediaEntry[] {
  return ilinkMediaBuffer;
}

export function getILinkCommandPending(): ((input: string) => void) | null {
  return iLinkCommandPending;
}

// ── Setters ──────────────────────────────────────────────────────────

export function setIlinkBridge(bridge: ILinkBridge | null) {
  ilinkBridge = bridge;
}

export function setIlinkActiveSessionId(sessionId: string | null) {
  ilinkActiveSessionId = sessionId;
}

export function setIlinkReplyBuffer(buffer: string) {
  ilinkReplyBuffer = buffer;
}

export function appendIlinkReplyBuffer(text: string) {
  ilinkReplyBuffer += text;
}

export function appendIlinkMediaBuffer(entry: IlinkMediaEntry) {
  ilinkMediaBuffer.push(entry);
}

export function clearIlinkMediaBuffer() {
  ilinkMediaBuffer = [];
}

export function setILinkCommandPending(fn: ((input: string) => void) | null) {
  iLinkCommandPending = fn;
}
