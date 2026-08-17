import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import sharp from "sharp";

const IMAGE_RE = /\.(png|jpe?g|webp|avif)$/;
const OUTPUT_FORMATS = ["webp", "avif", "jpeg"] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const FORMAT_RE = new RegExp(`(?:^|[?&])(${OUTPUT_FORMATS.join("|")})(?:$|&)`);
const EXT: Record<OutputFormat, string> = { webp: ".webp", avif: ".avif", jpeg: ".jpg" };
const MIME: Record<OutputFormat, string> = {
  webp: "image/webp",
  avif: "image/avif",
  jpeg: "image/jpeg",
};
const MAX_WIDTH = 1792;
const QUALITY = 80;

/**
 * Vite plugin: optimizes any image imported with a target-format query
 * suffix, e.g. `import img from ".../screenshot.png?webp"` or `?avif`.
 * - build: emits a hashed, width-capped asset in the requested format
 * - dev: serves the optimized image as a data URL
 */
export function optimizeImages(): Plugin {
  let config: ResolvedConfig;

  return {
    name: "fello:optimize-images",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
    },
    async resolveId(source, importer) {
      const format = matchFormatSuffix(source);
      if (!format) return null;
      const resolved = await this.resolve(source.slice(0, -format.length - 1), importer, {
        skipSelf: true,
      });
      if (!resolved) return null;
      return { id: resolved.id + `?${format}` };
    },
    async load(id) {
      const [file, query] = splitQuery(id);
      const match = query.match(FORMAT_RE);
      if (!match) return null;
      const format = match[1] as OutputFormat;
      if (!IMAGE_RE.test(file)) return null;

      const output = await sharp(await readFile(file))
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .toFormat(format, { quality: QUALITY })
        .toBuffer();

      if (config.command === "build") {
        const ref = this.emitFile({
          type: "asset",
          name: `${basename(file, extname(file))}${EXT[format]}`,
          source: output,
        });
        return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
      }

      return `export default "data:${MIME[format]};base64,${output.toString("base64")}"`;
    },
  };
}

function matchFormatSuffix(source: string): OutputFormat | null {
  const format = OUTPUT_FORMATS.find((f) => source.endsWith(`?${f}`));
  return format ?? null;
}

function splitQuery(id: string): [string, string] {
  const i = id.indexOf("?");
  return i === -1 ? [id, ""] : [id.slice(0, i), id.slice(i + 1)];
}
