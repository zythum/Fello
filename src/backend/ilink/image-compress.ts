import sharp from "sharp";

/**
 * Compress an image buffer to JPEG with reduced size.
 * Resizes if dimensions exceed maxDim, and compresses to target quality.
 * Returns a base64-encoded JPEG string.
 */
export async function compressImage(
  input: Buffer,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<string> {
  const { maxDim = 1280, quality = 70 } = opts;

  const result = await sharp(input)
    .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();

  return result.toString("base64");
}
