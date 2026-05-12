import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUpdatedTime(updatedAt: number): string {
  const date = new Date(updatedAt);
  const now = new Date();

  const isSameYear = date.getFullYear() === now.getFullYear();
  const isSameMonth = isSameYear && date.getMonth() === now.getMonth();
  const isSameDay = isSameMonth && date.getDate() === now.getDate();

  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;

  if (isSameDay) {
    return timeStr;
  }

  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  if (isSameYear) {
    return `${month}-${day} ${timeStr}`;
  }

  const year = date.getFullYear();
  return `${year}-${month}-${day} ${timeStr}`;
}

export function formatDuration(ms: number): string {
  if (ms < 0) return "0s";
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export function extractErrorMessage(error: unknown): string {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }

  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;

    if (typeof obj.message === "string" && obj.message.trim() !== "") {
      return obj.message;
    }

    if (typeof obj.error === "string" && obj.error.trim() !== "") {
      return obj.error;
    }

    if (obj.error instanceof Error) {
      return obj.error.message || String(obj.error);
    }

    try {
      const str = JSON.stringify(error);
      return str === "{}" ? String(error) : str;
    } catch {
      return String(error);
    }
  }

  return String(error);
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function getBasename(pathOrUri: string): string {
  if (!pathOrUri) return "";
  let p = pathOrUri;
  if (p.startsWith("file://")) {
    p = decodeURIComponent(p.slice(7));
  } else if (p.startsWith("http://") || p.startsWith("https://")) {
    try {
      p = new URL(p).pathname;
    } catch {
      // ignore
    }
  }
  // handle both posix and windows paths
  const segments = p.split(/[/\\]/);
  return segments.pop() || p;
}

export function isSubPath(parentDir: string, childPath: string): boolean {
  if (!parentDir || !childPath) return false;
  let p = parentDir.replace(/\\/g, "/");
  let c = childPath.replace(/\\/g, "/");
  if (!p.endsWith("/")) p += "/";
  if (!c.endsWith("/")) c += "/";
  return c.startsWith(p);
}

/**
 * Generate a UUID v4.
 *
 * Tries `crypto.randomUUID()` first (Web Crypto API), which requires a secure
 * context (HTTPS). Falls back to `crypto.getRandomValues()` which is available
 * in all contexts (including HTTP and file:// protocol).
 */
export function generateUUID(): string {
  // Prefer the standard randomUUID when available (secure contexts only)
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback: generate UUID v4 using crypto.getRandomValues
  // (available in all contexts, including non-HTTPS)
  const hex = "0123456789abcdef";
  const chars: string[] = Array.from({ length: 36 });
  const rnds = new Uint8Array(36);
  crypto.getRandomValues(rnds);

  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      chars[i] = "-";
    } else if (i === 14) {
      chars[i] = "4"; // UUID version 4
    } else if (i === 19) {
      chars[i] = hex[(rnds[i] & 0x3) | 0x8]; // UUID variant 10
    } else {
      chars[i] = hex[rnds[i] & 0xf];
    }
  }

  return chars.join("");
}
