import { resolve } from "path";
import { readFile, stat } from "fs/promises";
import type { Metadata } from "sharp";
import {
  tool,
  generateText,
  type FilePart,
  type ModelMessage,
  type TextPart,
  type ToolSet,
} from "ai";
import type { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import type { AgentClientProxy } from "./agent-client-proxy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageToolsParams = {
  /** Session ID (for tool_call UI updates) */
  sessionId: string;
  /** Working directory for resolving relative paths */
  cwd: string;
  /** Get the current ACP connection */
  getConnection: () => AgentClientProxy | null;
  /** Get the AI model instance (same model as the current session) */
  getModel: () => ReturnType<ReturnType<typeof createOpenAICompatible>["chatModel"]>;
  /** AbortSignal from the parent session */
  parentSignal?: AbortSignal;
};

export type ImageToolBundle = {
  tools: ToolSet;
  /**
   * Attach images loaded by ImageRead to the next model step as user content.
   * Returns undefined when nothing is pending.
   */
  injectPendingImages: (messages: ModelMessage[]) => ModelMessage[] | undefined;
};

type ImageInput = {
  name: string;
  path: string;
};

type LoadedImage = {
  name: string;
  width: number;
  height: number;
  bytes: number;
  base64Bytes: number;
  resized: boolean;
};

type LoadedImages = {
  content: Array<TextPart | FilePart>;
  loaded: LoadedImage[];
  failures: string[];
  usedBase64Bytes: number;
};

// ---------------------------------------------------------------------------
// Image preprocessing
// ---------------------------------------------------------------------------

/** Reject source files above this size before decoding. */
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
/** Per-image base64 budget (excluding the data: prefix). */
const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;
/**
 * Total base64 budget for one tool call (and for all pending ImageRead images).
 * 20 MB base64 塞进一个请求体、还要在每个 step 重发，实际会先撞上服务端的请求体
 * 上限，所以在本地就收到 12 MB，超限的图直接报错而不是等 provider 回 413。
 */
const MAX_TOTAL_BASE64_BYTES = 12 * 1024 * 1024;
/** Longest side after resizing, for a single image. */
const MAX_IMAGE_DIMENSION = 2000;
/** 一批多张时单张最长边的下限，避免张数一多就缩成看不清的小图。 */
const MIN_BATCH_DIMENSION = 640;
/** Guard against decompression bombs. */
const MAX_INPUT_PIXELS = 100_000_000;

const JPEG_QUALITIES = [88, 80, 72, 64] as const;
const SHRINK_FACTOR = 0.82;
const MAX_SHRINK_STEPS = 8;

type SharpModule = typeof import("sharp").default;
let sharpPromise: Promise<SharpModule> | null = null;

/** Lazy-load sharp so the native module is only loaded when an image is read. */
function getSharp(): Promise<SharpModule> {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((module) => module.default)
      .catch((error) => {
        sharpPromise = null;
        throw error;
      });
  }
  return sharpPromise;
}

export type PreparedImage = {
  buffer: Buffer;
  mediaType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  resized: boolean;
  firstFrameOnly: boolean;
};

function base64Length(buffer: Buffer): number {
  return Math.ceil(buffer.length / 3) * 4;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function orientedDimensions(metadata: Metadata): { width: number; height: number } {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  // EXIF orientations 5-8 rotate the image by 90 degrees, so width/height swap.
  const swapped = metadata.orientation != null && metadata.orientation >= 5;
  return swapped ? { width: height, height: width } : { width, height };
}

function fitDimensions(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height, 1);
  const scale = Math.min(1, max / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 一批图片里单张的尺寸上限。
 * 图片 token 数基本与像素数成正比（实测 deepseek：2000×1500 ≈ 1000 tokens/张），
 * 所以张数越多、单张越要降采样：最长边按 √N 缩放，让一批的总像素大致恒定。
 * N=1→2000px，2→1414px，4→1000px，8→707px，10→632px（不低于 640px）。
 */
function batchMaxDimension(count: number): number {
  if (count <= 1) return MAX_IMAGE_DIMENSION;
  const scaled = Math.round(MAX_IMAGE_DIMENSION / Math.sqrt(count));
  return Math.max(MIN_BATCH_DIMENSION, Math.min(MAX_IMAGE_DIMENSION, scaled));
}

/**
 * Decode, auto-orient, resize and re-encode an image so it fits the per-image
 * base64 budget. Alpha images stay PNG; opaque images become JPEG, shrinking
 * quality and dimensions until they fit.
 */
export async function prepareImageForModel(
  absPath: string,
  maxBase64Bytes: number,
  maxDimension: number = MAX_IMAGE_DIMENSION,
): Promise<PreparedImage> {
  const fileStat = await stat(absPath);
  if (!fileStat.isFile()) {
    throw new Error("not a regular file");
  }
  if (fileStat.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(
      `file is ${formatMegabytes(fileStat.size)}, exceeding the ${formatMegabytes(MAX_SOURCE_IMAGE_BYTES)} source limit`,
    );
  }

  const input = await readFile(absPath);
  const sharp = await getSharp();

  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch (error) {
    throw new Error(`could not decode image (unsupported or corrupt format): ${errorMessage(error)}`);
  }

  if (!metadata.format) {
    throw new Error("file is not a recognized image");
  }

  const { width: sourceWidth, height: sourceHeight } = orientedDimensions(metadata);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("image has no usable dimensions");
  }

  const hasAlpha = metadata.hasAlpha === true;
  const mediaType = hasAlpha ? ("image/png" as const) : ("image/jpeg" as const);
  const firstFrameOnly = (metadata.pages ?? 1) > 1;

  let { width, height } = fitDimensions(sourceWidth, sourceHeight, maxDimension);

  for (let step = 0; step <= MAX_SHRINK_STEPS; step++) {
    // PNG has no quality knob; opaque JPEG candidates trade quality for bytes.
    const qualities: ReadonlyArray<number | null> = hasAlpha ? [null] : JPEG_QUALITIES;

    for (const quality of qualities) {
      const pipeline = sharp(input, {
        failOn: "error",
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize({ width, height, fit: "inside", withoutEnlargement: true });

      const encoded =
        quality === null
          ? await pipeline
              .png({ compressionLevel: 9, adaptiveFiltering: true })
              .toBuffer({ resolveWithObject: true })
          : await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });

      if (base64Length(encoded.data) <= maxBase64Bytes) {
        return {
          buffer: encoded.data,
          mediaType,
          width: encoded.info.width,
          height: encoded.info.height,
          sourceWidth,
          sourceHeight,
          resized: encoded.info.width !== sourceWidth || encoded.info.height !== sourceHeight,
          firstFrameOnly,
        };
      }
    }

    if (width <= 64 && height <= 64) break;
    width = Math.max(1, Math.round(width * SHRINK_FACTOR));
    height = Math.max(1, Math.round(height * SHRINK_FACTOR));
  }

  throw new Error(
    `could not fit image within ${formatMegabytes(maxBase64Bytes)} even after resizing`,
  );
}

/**
 * Read, normalize and encode a batch of images. One unreadable image must not
 * discard the others, so failures are collected separately and the batch shares
 * a single total byte budget. 尺寸上限按本批张数决定：一次读得越多，单张越小。
 */
async function loadImagesForModel(
  images: ImageInput[],
  cwd: string,
  maxTotalBase64Bytes: number = MAX_TOTAL_BASE64_BYTES,
): Promise<LoadedImages> {
  const content: Array<TextPart | FilePart> = [];
  const loaded: LoadedImage[] = [];
  const failures: string[] = [];
  let usedBase64Bytes = 0;
  const maxDimension = batchMaxDimension(images.length);

  for (const image of images) {
    try {
      const remaining = maxTotalBase64Bytes - usedBase64Bytes;
      if (remaining <= 0) {
        failures.push(`${image.name} (${image.path}): skipped, image budget exhausted`);
        continue;
      }

      const absPath = resolve(cwd, image.path);
      const prepared = await prepareImageForModel(
        absPath,
        Math.min(MAX_IMAGE_BASE64_BYTES, remaining),
        maxDimension,
      );
      const encodedBytes = base64Length(prepared.buffer);
      usedBase64Bytes += encodedBytes;

      // 图片前插入一行 name 与尺寸标签，让模型能区分并引用具体图片
      const sizeNote = `${prepared.width}×${prepared.height} px, ${formatMegabytes(prepared.buffer.length)}`;
      const resizeNote = prepared.resized
        ? ` (resized from ${prepared.sourceWidth}×${prepared.sourceHeight})`
        : "";
      const frameNote = prepared.firstFrameOnly ? ", first frame only" : "";
      content.push({
        type: "text",
        text: `Image "${image.name}": ${sizeNote}${resizeNote}${frameNote}`,
      });
      content.push({
        type: "file",
        data: prepared.buffer,
        mediaType: prepared.mediaType,
      });
      loaded.push({
        name: image.name,
        width: prepared.width,
        height: prepared.height,
        bytes: prepared.buffer.length,
        base64Bytes: encodedBytes,
        resized: prepared.resized,
      });
    } catch (error) {
      failures.push(`${image.name} (${image.path}): ${errorMessage(error)}`);
    }
  }

  return { content, loaded, failures, usedBase64Bytes };
}

// ---------------------------------------------------------------------------
// Vision capability probe
// ---------------------------------------------------------------------------

/**
 * 探测结果只缓存 3 小时：服务商随时可能给同名模型补上视觉能力（也可能下线），
 * 过期后重新探测，避免把一次判断永久钉死。
 */
const VISION_PROBE_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * 探测图：2×2 纯色网格。四种颜色刻意不按「红绿蓝黄」的阅读顺序排列，
 * 这样只有真的看到图才能按「左上/右上/左下/右下」答对——按常识把四个常见颜色
 * 挨个猜一遍顺序必然对不上。用几何色块而不是文字，避免依赖运行环境里有没有字体。
 */
const PROBE_CELLS = [
  { hex: "#0044ff", words: ["blue", "蓝"] }, // 左上
  { hex: "#ffdd00", words: ["yellow", "黄"] }, // 右上
  { hex: "#ff0000", words: ["red", "红"] }, // 左下
  { hex: "#00b400", words: ["green", "绿"] }, // 右下
] as const;

const PROBE_PROMPT =
  "The attached image is a 2x2 grid of solid colors. Reply with only the color of each cell in this exact order: top-left, top-right, bottom-left, bottom-right. One word per cell, comma separated. If you cannot see an image at all, reply with exactly: NO IMAGE";

type ModelInstance = ReturnType<ImageToolsParams["getModel"]>;

type VisionVerdict = { supportsVision: boolean; checkedAt: number };

/** 按 `provider:modelId` 缓存结论，跨会话 / 跨轮次共享。 */
const visionVerdictCache = new Map<string, VisionVerdict>();
/** 同一模型的探测并发去重，避免一轮里多次 ImageRead 触发多次探测。 */
const visionProbeInFlight = new Map<string, Promise<boolean | null>>();

let probeImagePromise: Promise<Buffer> | null = null;

function buildProbeImage(): Promise<Buffer> {
  if (!probeImagePromise) {
    probeImagePromise = (async () => {
      const sharp = await getSharp();
      const cell = 64;
      const rects = PROBE_CELLS.map((item, index) => {
        const x = (index % 2) * cell;
        const y = Math.floor(index / 2) * cell;
        return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${item.hex}"/>`;
      }).join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cell * 2}" height="${cell * 2}">${rects}</svg>`;
      return sharp(Buffer.from(svg)).png().toBuffer();
    })().catch((error) => {
      probeImagePromise = null;
      throw error;
    });
  }
  return probeImagePromise;
}

function wordIndex(haystack: string, word: string): number {
  // 英文加词边界，避免 "red" 命中 "hundred" 这类误判。
  if (/^[a-z]+$/.test(word)) {
    const match = new RegExp(`\\b${word}\\b`).exec(haystack);
    return match ? match.index : -1;
  }
  return haystack.indexOf(word);
}

/**
 * 回答是否按「左上/右上/左下/右下」的顺序说出了四种颜色。
 * 顺序也对上才算真看见，否则可能只是把四个常见颜色猜了一遍。
 */
function describesProbeImage(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("no image")) return false;

  let lastIndex = -1;
  for (const cell of PROBE_CELLS) {
    let index = -1;
    for (const word of cell.words) {
      const found = wordIndex(lower, word);
      if (found !== -1 && (index === -1 || found < index)) index = found;
    }
    if (index === -1 || index <= lastIndex) return false;
    lastIndex = index;
  }
  return true;
}

/**
 * 探测失败（网络、鉴权、用户取消等）返回 null —— 此时无法判断能力，
 * 调用方按「支持」处理以保持原有行为，且不写缓存。
 */
async function probeVisionSupport(
  model: ModelInstance,
  signal?: AbortSignal,
): Promise<boolean | null> {
  try {
    const image = await buildProbeImage();
    const result = await generateText({
      model,
      maxRetries: 0,
      temperature: 0,
      // 不能用很小的上限：推理型模型会先把预算花在 reasoning token 上，
      // 32 token 会直接得到空文本，把能看图的模型误判成看不见。
      maxOutputTokens: 512,
      abortSignal: signal,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROBE_PROMPT },
            { type: "file", data: image, mediaType: "image/png" },
          ],
        },
      ],
      providerOptions: {
        openaiCompatible: {
          thinking: { type: "disabled" },
          enable_thinking: false,
        },
      },
    });
    // 空回答不算「看不见」的证据：可能是推理模型把预算烧在了 reasoning 上，
    // 或服务端返回了空 delta。这种情况按「无法判断」处理，不写缓存。
    if (!result.text.trim()) return null;

    return describesProbeImage(result.text);
  } catch {
    return null;
  }
}

/**
 * 当前模型是否真的能看图。命中 3 小时缓存直接返回，否则发一次极小的探测请求。
 * 探测失败时按「支持」处理（不写缓存），避免因为一次网络抖动就把工具锁死。
 */
async function modelSupportsVision(model: ModelInstance, signal?: AbortSignal): Promise<boolean> {
  const key = `${model.provider}:${model.modelId}`;

  const cached = visionVerdictCache.get(key);
  if (cached && Date.now() - cached.checkedAt < VISION_PROBE_TTL_MS) {
    return cached.supportsVision;
  }

  const inFlight = visionProbeInFlight.get(key);
  if (inFlight) {
    const verdict = await inFlight;
    return verdict ?? true;
  }

  const probe = probeVisionSupport(model, signal)
    .then((verdict) => {
      if (verdict !== null) {
        visionVerdictCache.set(key, { supportsVision: verdict, checkedAt: Date.now() });
      }
      return verdict;
    })
    .finally(() => {
      visionProbeInFlight.delete(key);
    });

  visionProbeInFlight.set(key, probe);
  const verdict = await probe;
  return verdict ?? true;
}

// ---------------------------------------------------------------------------
// Shared schema
// ---------------------------------------------------------------------------

const imagesSchema = z
  .array(
    z.object({
      name: z
        .string()
        .describe(
          "Short label identifying this image (e.g. 'login page' or 'before'). It is sent to the model as the image's caption and also shown in the UI.",
        ),
      path: z.string().describe("Absolute or project-relative path to the image file."),
    }),
  )
  .min(1)
  .max(10)
  .describe("Images to read together, in order. Min 1, max 10.");

const NORMALIZATION_NOTE =
  "Images are decoded and normalized before they are sent: the longest side is capped at 2000 px for a single image and shrinks automatically when a call carries several images (each image is downscaled so a large batch does not blow up the context), each image is re-encoded to fit 5 MB (12 MB per call in total), EXIF metadata is stripped, and the first frame of an animated image is used. Non-image files and images above the 20 MB source limit are rejected with an error naming the file.";

const BATCH_GUIDANCE =
  "Read 1–4 images per call when they answer the same question; add more only when the images genuinely need to be compared. Each extra image costs tokens, so prefer a few focused reads over dumping many files at once (10 per call is a hard limit).";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createImageTools(params: ImageToolsParams): ImageToolBundle {
  // Images requested by ImageRead, waiting for the next model step.
  const pending: Array<TextPart | FilePart> = [];
  let pendingBase64Bytes = 0;

  /**
   * 图片类工具的前置检查：模型不接受图片时立刻失败并说明原因。
   * 否则图片会被服务商静默丢弃（实测部分 openai-compatible 服务端就是 200 + 丢图），
   * 模型会照着上下文编造内容；严格校验的服务端则会 400 掉整个 turn。
   */
  async function assertVisionSupport(): Promise<void> {
    const model = params.getModel();
    if (await modelSupportsVision(model, params.parentSignal)) return;
    throw new Error(
      `the current model (${model.modelId}) does not accept image input — a probe image of four solid colors was not recognized. Switch to a vision-capable model to work with images.`,
    );
  }

  const imageAnalysis = tool({
    description: `Analyze one or more image files by reading them and using vision capabilities to understand their content.

Use this when you need a written answer about image content (e.g., describe what's in the image, extract text from a screenshot, analyze a diagram, identify UI elements, read charts). Every image in one call is analyzed in one go: each image carries a name that labels it in the request, so you can refer to that name in the query and attribute the findings in the answer.

${BATCH_GUIDANCE}

If you need to inspect the actual pixels yourself rather than receive a text description, use ImageRead instead.

This tool needs a vision-capable model: the first call checks whether the current model can actually see images (the verdict is cached for 3 hours) and fails with an explanation if it cannot.

For simple metadata queries (dimensions, format), use image_metadata instead.

${NORMALIZATION_NOTE}

Provide a specific query describing what you want to know about the images — the more specific the query, the better the analysis.`,
    inputSchema: z.object({
      images: imagesSchema,
      query: z
        .string()
        .min(1)
        .describe(
          "What you want to know about the images. Be specific (e.g., 'Extract all text from this screenshot', 'Describe the UI layout', 'Which of these charts has the highest value?').",
        ),
    }),
    execute: async ({ images, query }, { toolCallId }) => {
      const connection = params.getConnection();
      const imageLabel = images.map((image) => image.name).join(", ");

      // Broadcast tool_call start
      if (connection) {
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId,
            title: `image_analysis ${imageLabel}`,
            kind: "read" as const,
            status: "in_progress",
            rawInput: { images, query },
          },
        });
      }

      try {
        await assertVisionSupport();

        const { content, failures } = await loadImagesForModel(images, params.cwd);

        if (content.length === 0) {
          throw new Error(`Failed to read any image — ${failures.join("; ")}`);
        }

        content.push({ type: "text", text: query });

        // Run internal inference with the images as user message content blocks
        const result = await generateText({
          model: params.getModel(),
          messages: [
            {
              role: "user",
              content,
            },
          ],
          abortSignal: params.parentSignal,
          providerOptions: {
            openaiCompatible: {
              thinking: { type: "disabled" },
              enable_thinking: false,
            },
          },
        });

        const analysisText = result.text || "(no analysis returned)";
        const outputText =
          failures.length > 0
            ? `${analysisText}\n\n[failed to read: ${failures.join("; ")}]`
            : analysisText;

        // Broadcast tool_call completion
        if (connection) {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: "completed",
              content: [
                {
                  type: "content" as const,
                  content: { type: "text" as const, text: outputText },
                },
              ],
            },
          });
        }

        return outputText;
      } catch (error) {
        const errorText = errorMessage(error);

        // Broadcast tool_call failure
        if (connection) {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: "failed",
              content: [
                {
                  type: "content" as const,
                  content: {
                    type: "text" as const,
                    text: `Error analyzing images: ${errorText}`,
                  },
                },
              ],
            },
          });
        }

        return `Error analyzing images: ${errorText}`;
      }
    },
  });

  const imageRead = tool({
    description: `Load local image files into the conversation so you can see them directly.

Use this when you need to inspect the actual pixels yourself: UI screenshots, design mockups, diagrams, charts, photos. The images are attached to your next step as user content, so you can reason about layout, color, alignment and other visual details. The attachment lasts for that single step only: if a later step still needs the image, call ImageRead again. If you only need a written description and do not need to see the image yourself, use ImageAnalysis instead. This tool requires a vision-capable model: the first call checks whether the current model can actually see images (the verdict is cached for 3 hours) and fails with an explanation if it cannot.

${BATCH_GUIDANCE}

${NORMALIZATION_NOTE}`,
    inputSchema: z.object({
      images: imagesSchema,
    }),
    execute: async ({ images }, { toolCallId }) => {
      const connection = params.getConnection();
      const imageLabel = images.map((image) => image.name).join(", ");

      // Broadcast tool_call start
      if (connection) {
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId,
            title: `image_read ${imageLabel}`,
            kind: "read" as const,
            status: "in_progress",
            rawInput: { images },
          },
        });
      }

      try {
        await assertVisionSupport();

        const remaining = MAX_TOTAL_BASE64_BYTES - pendingBase64Bytes;
        if (remaining <= 0) {
          throw new Error("image budget exhausted for this turn");
        }

        const { content, loaded, failures, usedBase64Bytes } = await loadImagesForModel(
          images,
          params.cwd,
          remaining,
        );

        if (loaded.length === 0) {
          throw new Error(`Failed to read any image — ${failures.join("; ")}`);
        }

        pendingBase64Bytes += usedBase64Bytes;
        pending.push(...content);

        const summary = loaded
          .map(
            (image) =>
              `${image.name} (${image.width}×${image.height} px, ${formatMegabytes(image.bytes)})`,
          )
          .join(", ");
        const outputText = [
          `Loaded ${loaded.length} image(s) for viewing: ${summary}.`,
          failures.length > 0 ? `[failed to read: ${failures.join("; ")}]` : "",
        ]
          .filter(Boolean)
          .join("\n");

        // Broadcast tool_call completion
        if (connection) {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: "completed",
              content: [
                {
                  type: "content" as const,
                  content: { type: "text" as const, text: outputText },
                },
              ],
            },
          });
        }

        return outputText;
      } catch (error) {
        const errorText = errorMessage(error);

        // Broadcast tool_call failure
        if (connection) {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: "failed",
              content: [
                {
                  type: "content" as const,
                  content: {
                    type: "text" as const,
                    text: `Error reading images: ${errorText}`,
                  },
                },
              ],
            },
          });
        }

        return `Error reading images: ${errorText}`;
      }
    },
  });

  return {
    tools: { ImageAnalysis: imageAnalysis, ImageRead: imageRead },
    injectPendingImages: (messages) => {
      if (pending.length === 0) return undefined;

      const content = pending.splice(0, pending.length);
      pendingBase64Bytes = 0;

      return [
        ...messages,
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "The images requested with ImageRead are attached below. Use them to answer the user's request.",
            },
            ...content,
          ],
        },
      ];
    },
  };
}
