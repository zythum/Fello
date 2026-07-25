import { join, resolve, dirname, basename, extname } from "path";
import { writeFile } from "fs/promises";
import { createHash, randomUUID, randomInt } from "crypto";
import sharp, { type Metadata } from "sharp";
import {
  base64EncodeRequestSchema,
  base64DecodeRequestSchema,
  urlEncodeRequestSchema,
  urlDecodeRequestSchema,
  hashRequestSchema,
  timeRequestSchema,
  shortIdRequestSchema,
  randomRequestSchema,
  randIntRequestSchema,
  choiceRequestSchema,
  shuffleRequestSchema,
  imageMetadataRequestSchema,
  imageThumbnailRequestSchema,
  imageResizeRequestSchema,
  imageConvertRequestSchema,
  type Base64EncodeRespond,
  type Base64DecodeRespond,
  type UrlEncodeRespond,
  type UrlDecodeRespond,
  type HashRespond,
  type TimeRespond,
  type UuidRespond,
  type ShortIdRespond,
  type RandomRespond,
  type RandIntRespond,
  type ChoiceRespond,
  type ShuffleRespond,
  type ImageMetadataRespond,
  type ImageThumbnailRespond,
  type ImageResizeRespond,
  type ImageConvertRespond,
} from "../shared/zod/mcp-toolbox-schema";
import type { SocketServer } from "./socket-server";
import type { BackendContext } from "./types";

// ── Types ────────────────────────────────────────────────────────────

export interface ToolboxModule {
  registerToolboxRoute: (server: SocketServer, projectDir: string) => void;
  buildToolboxMcpServer: (options: { projectDir: string; socketPath: string }) => {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  };
}

// ── Charsets ─────────────────────────────────────────────────────────

const CHARSETS = {
  alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  numeric: "0123456789",
  hex: "0123456789abcdef",
};

// ── Factory ──────────────────────────────────────────────────────────

export function createToolboxModule(_ctx: BackendContext): ToolboxModule {
  function extractMetadata(metadata: Metadata) {
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      space: metadata.space,
      channels: metadata.channels,
      depth: metadata.depth,
      density: metadata.density,
      hasAlpha: metadata.hasAlpha,
      size: metadata.size,
    };
  }

  function registerToolboxRoute(server: SocketServer, projectDir: string) {
    // ── Base64 ─────────────────────────────────────────────────────
    server.registry("toolbox/base64-encode", async (payload): Promise<Base64EncodeRespond> => {
      const { text } = base64EncodeRequestSchema.parse(payload);
      return { result: Buffer.from(text, "utf-8").toString("base64") };
    });

    server.registry("toolbox/base64-decode", async (payload): Promise<Base64DecodeRespond> => {
      const { base64 } = base64DecodeRequestSchema.parse(payload);
      return { result: Buffer.from(base64, "base64").toString("utf-8") };
    });

    // ── URL Encode/Decode ──────────────────────────────────────────
    server.registry("toolbox/url-encode", async (payload): Promise<UrlEncodeRespond> => {
      const { text } = urlEncodeRequestSchema.parse(payload);
      return { result: encodeURIComponent(text) };
    });

    server.registry("toolbox/url-decode", async (payload): Promise<UrlDecodeRespond> => {
      const { text } = urlDecodeRequestSchema.parse(payload);
      return { result: decodeURIComponent(text) };
    });

    // ── Hash ───────────────────────────────────────────────────────
    server.registry("toolbox/hash", async (payload): Promise<HashRespond> => {
      const { text, algorithm } = hashRequestSchema.parse(payload);
      const hash = createHash(algorithm).update(text, "utf-8").digest("hex");
      return { result: hash };
    });

    // ── Time ───────────────────────────────────────────────────────
    server.registry("toolbox/time", async (payload): Promise<TimeRespond> => {
      const { format } = timeRequestSchema.parse(payload);
      if (format === "timestamp") {
        return { result: Math.floor(Date.now() / 1000) };
      }
      return { result: new Date().toISOString() };
    });

    // ── UUID ───────────────────────────────────────────────────────
    server.registry("toolbox/uuid", async (): Promise<UuidRespond> => {
      return { result: randomUUID() };
    });

    // ── Short ID ───────────────────────────────────────────────────
    server.registry("toolbox/short-id", async (payload): Promise<ShortIdRespond> => {
      const { length } = shortIdRequestSchema.parse(payload);
      const chars = CHARSETS.alphanumeric;
      let id = "";
      for (let i = 0; i < length; i++) {
        id += chars[randomInt(chars.length)];
      }
      return { result: id };
    });

    // ── Random ─────────────────────────────────────────────────────
    server.registry("toolbox/random", async (payload): Promise<RandomRespond> => {
      const { length, charset } = randomRequestSchema.parse(payload);
      const chars = CHARSETS[charset];
      let str = "";
      for (let i = 0; i < length; i++) {
        str += chars[randomInt(chars.length)];
      }
      return { result: str };
    });

    // ── RandInt ────────────────────────────────────────────────────
    server.registry("toolbox/rand-int", async (payload): Promise<RandIntRespond> => {
      const { min, max } = randIntRequestSchema.parse(payload);
      return { result: randomInt(min, max + 1) };
    });

    // ── Choice ─────────────────────────────────────────────────────
    server.registry("toolbox/choice", async (payload): Promise<ChoiceRespond> => {
      const { items } = choiceRequestSchema.parse(payload);
      return { result: items[randomInt(items.length)] };
    });

    // ── Shuffle ────────────────────────────────────────────────────
    server.registry("toolbox/shuffle", async (payload): Promise<ShuffleRespond> => {
      const { items } = shuffleRequestSchema.parse(payload);
      const arr = [...items];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return { result: arr };
    });

    // ── Image Metadata ─────────────────────────────────────────────
    server.registry("toolbox/image-metadata", async (payload): Promise<ImageMetadataRespond> => {
      const { path: imgPath } = imageMetadataRequestSchema.parse(payload);
      const absPath = resolve(projectDir, imgPath);
      const metadata = await sharp(absPath).metadata();
      return { result: extractMetadata(metadata) };
    });

    // ── Image Thumbnail ────────────────────────────────────────────
    server.registry("toolbox/image-thumbnail", async (payload): Promise<ImageThumbnailRespond> => {
      const { path: imgPath, width, output } = imageThumbnailRequestSchema.parse(payload);
      const absPath = resolve(projectDir, imgPath);
      const outputPath = output
        ? resolve(projectDir, output)
        : join(
            dirname(absPath),
            `${basename(absPath, extname(absPath))}.thumb${width}${extname(absPath)}`,
          );
      await sharp(absPath).resize(width).toFile(outputPath);
      const metadata = await sharp(outputPath).metadata();
      return { result: { output: outputPath, metadata: extractMetadata(metadata) } };
    });

    // ── Image Resize ───────────────────────────────────────────────
    server.registry("toolbox/image-resize", async (payload): Promise<ImageResizeRespond> => {
      const { path: imgPath, width, height, fit, output } = imageResizeRequestSchema.parse(payload);
      const absPath = resolve(projectDir, imgPath);
      const resized = await sharp(absPath).resize({ width, height, fit }).toBuffer();
      const resizedMeta = await sharp(resized).metadata();
      const actualWidth = resizedMeta.width ?? width ?? 0;
      const actualHeight = resizedMeta.height ?? height ?? 0;
      const ext = extname(absPath);
      const base = basename(absPath, ext);
      const outputPath = output
        ? resolve(projectDir, output)
        : join(dirname(absPath), `${base}.${actualWidth}x${actualHeight}${ext}`);
      await writeFile(outputPath, resized);
      const metadata = await sharp(outputPath).metadata();
      return { result: { output: outputPath, metadata: extractMetadata(metadata) } };
    });

    // ── Image Convert ──────────────────────────────────────────────
    server.registry("toolbox/image-convert", async (payload): Promise<ImageConvertRespond> => {
      const { path: imgPath, format, quality, output } = imageConvertRequestSchema.parse(payload);
      const absPath = resolve(projectDir, imgPath);
      const outputPath = output
        ? resolve(projectDir, output)
        : join(dirname(absPath), `${basename(absPath, extname(absPath))}.${format}`);
      let pipeline = sharp(absPath);
      const opts: { quality?: number } = {};
      if (quality !== undefined) opts.quality = quality;
      pipeline = pipeline.toFormat(format, opts);
      await pipeline.toFile(outputPath);
      const metadata = await sharp(outputPath).metadata();
      return { result: { output: outputPath, metadata: extractMetadata(metadata) } };
    });
  }

  function buildToolboxMcpServer(options: { projectDir: string; socketPath: string }) {
    return {
      name: "toolbox",
      command: process.execPath,
      args: [
        join(process.scriptsPath, "mcp-toolbox/server.mjs"),
        "--project-dir",
        options.projectDir,
        "--socket-path",
        options.socketPath,
      ],
      env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
    };
  }

  return {
    registerToolboxRoute,
    buildToolboxMcpServer,
  };
}
