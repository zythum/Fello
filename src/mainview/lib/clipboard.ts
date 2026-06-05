/**
 * Clipboard utilities with HTTP fallback.
 *
 * `navigator.clipboard` requires a secure context (HTTPS or localhost).
 * - write: falls back to `execCommand("copy")` — works in HTTP.
 * - read: no reliable HTTP fallback — callers should check capability first.
 */

let _hasClipboardApi: boolean | null = null;

function hasClipboardApi(): boolean {
  if (_hasClipboardApi !== null) return _hasClipboardApi;
  _hasClipboardApi =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function" &&
    typeof navigator.clipboard?.readText === "function";
  return _hasClipboardApi;
}

/**
 * Returns true if `navigator.clipboard` is available.
 * Use this to conditionally show/hide paste buttons.
 */
export function isClipboardApiAvailable(): boolean {
  return hasClipboardApi();
}

/**
 * Copy text to clipboard.
 * Uses `navigator.clipboard` when available, falls back to `execCommand("copy")`.
 */
export async function copyText(text: string): Promise<boolean> {
  if (hasClipboardApi()) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied — fall through to fallback
    }
  }

  // Fallback: execCommand (works in HTTP, deprecated but still supported)
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Read text from clipboard.
 * Only works in secure contexts (HTTPS/localhost).
 * No reliable HTTP fallback — check `isClipboardApiAvailable()` before calling.
 */
export async function readText(): Promise<string | null> {
  if (!hasClipboardApi()) return null;
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
