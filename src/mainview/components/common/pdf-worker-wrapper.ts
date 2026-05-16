// Polyfill Uint8Array.prototype.toHex() for environments that don't support it yet
// (e.g., older Electron, Node.js). pdfjs-dist v5.x relies on this ES2024 built-in.
// The legacy build also includes this polyfill, but we keep it here as a fallback.
if (typeof Uint8Array.prototype.toHex !== "function") {
  Uint8Array.prototype.toHex = function (): string {
    const hex = Array.from(this, (byte: number) => byte.toString(16).padStart(2, "0"));
    return hex.join("");
  };
}

// Use the legacy build which includes polyfills for Map.prototype.getOrInsertComputed,
// Promise.withResolvers, and other APIs not available in Electron 37 (Chromium 138).
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
