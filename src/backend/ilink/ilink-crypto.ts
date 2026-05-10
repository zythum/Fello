import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

/**
 * AES-128-ECB + PKCS7 padding utilities for WeChat iLink CDN media.
 */

const AES_BLOCK_SIZE = 16;

function pkcs7Pad(buffer: Buffer): Buffer {
  const padLen = AES_BLOCK_SIZE - (buffer.length % AES_BLOCK_SIZE);
  const padding = Buffer.alloc(padLen, padLen);
  return Buffer.concat([buffer, padding]);
}

function pkcs7Unpad(buffer: Buffer): Buffer {
  const padLen = buffer[buffer.length - 1];
  if (padLen < 1 || padLen > AES_BLOCK_SIZE) return buffer;
  return buffer.subarray(0, buffer.length - padLen);
}

export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  const padded = pkcs7Pad(plaintext);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return pkcs7Unpad(padded);
}

/**
 * Calculate encrypted file size after AES-128-ECB + PKCS7 padding.
 *   ceil((rawSize + 1) / 16) * 16
 */
export function aesEcbPaddedSize(rawSize: number): number {
  return Math.ceil((rawSize + 1) / AES_BLOCK_SIZE) * AES_BLOCK_SIZE;
}

/**
 * Decode AES key from iLink's two possible encodings:
 *   Format A: base64(raw 16 bytes)  → decode → 16 bytes
 *   Format B: base64(hex string)    → decode → 32 hex chars → decode → 16 bytes
 */
export function decodeAesKey(encoded: string): Buffer {
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32) {
    const hex = decoded.toString("utf-8");
    if (/^[0-9a-fA-F]{32}$/.test(hex)) {
      return Buffer.from(hex, "hex");
    }
  }
  throw new Error(`Unable to decode AES key (len=${decoded.length})`);
}

/**
 * Decode AES key from hex string (image_item.aeskey format).
 */
export function decodeAesKeyHex(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

/**
 * Compute MD5 of a buffer.
 */
export function md5Buffer(buffer: Buffer): string {
  return createHash("md5").update(buffer).digest("hex");
}

/**
 * Generate a random 16-byte hex filekey for CDN uploads.
 */
export function randomFileKey(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Generate a random 16-byte AES key as hex string.
 */
export function randomAesKeyHex(): string {
  return randomBytes(16).toString("hex");
}
