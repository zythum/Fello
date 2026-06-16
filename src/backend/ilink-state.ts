import type { ILinkBridge } from "./ilink/ilink-bridge";

// ── Mutable State ────────────────────────────────────────────────────

let ilinkBridge: ILinkBridge | null = null;
let ilinkActiveSessionId: string | null = null;
let ilinkReplyBuffer = "";
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

export function setILinkCommandPending(fn: ((input: string) => void) | null) {
  iLinkCommandPending = fn;
}
