import { randomUUID } from "crypto";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import type { SocketServer } from "./socket-server";
import type { BackendContext } from "./types";
import type { IlinkState } from "./ilink";
import {
  imageGenerationRequestSchema,
  type ImageGenerationRequest,
  type ImageGenerationRespond,
  type ImageGenerationImage,
} from "../shared/zod/mcp-image-generation-schema";
import type { ImageGenerationProviderInfo } from "../shared/schema";

// ── Types ────────────────────────────────────────────────────────────

export interface ImageGenerationResult {
  /** fello 字段，用于前端渲染 */
  respond: ImageGenerationRespond;
  /** 图片的绝对文件路径列表，返回给 LLM 供后续引用 */
  filePaths: string[];
}

export interface ImageGenerationModule {
  generateImage: (
    sessionId: string,
    request: ImageGenerationRequest,
  ) => Promise<ImageGenerationResult>;
  registerImageGenerationRoute: (server: SocketServer, sessionId: string) => void;
  buildImageGenerationMcpServer: (options: { projectDir: string; socketPath: string }) => {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  };
}

// ── OpenAI-compatible API caller ─────────────────────────────────────

interface OpenAIImageResponseItem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

interface OpenAIImageResponse {
  data: OpenAIImageResponseItem[];
}

/**
 * Detect image format from base64 data by checking magic bytes.
 * Returns { ext, mimeType }.
 */
function detectImageFormat(buffer: Buffer): { ext: string; mimeType: string } {
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: "png", mimeType: "image/png" };
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mimeType: "image/jpeg" };
  }
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { ext: "webp", mimeType: "image/webp" };
  }
  // GIF: 47 49 46
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { ext: "gif", mimeType: "image/gif" };
  }
  // Default to PNG
  return { ext: "png", mimeType: "image/png" };
}

async function fetchImageBuffer(item: OpenAIImageResponseItem): Promise<Buffer> {
  if (item.b64_json) {
    return Buffer.from(item.b64_json, "base64");
  }
  if (item.url) {
    const response = await fetch(item.url);
    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("Image generation API returned neither b64_json nor url");
}

async function callOpenAICompatibleApi(
  provider: ImageGenerationProviderInfo,
  request: ImageGenerationRequest,
): Promise<OpenAIImageResponse> {
  const url = `${provider.baseUrl.replace(/\/+$/, "")}/images/generations`;

  const body: Record<string, unknown> = {
    ...provider.extraBody,
    model: provider.model,
    prompt: request.prompt,
    n: request.n ?? 1,
    size: request.size,
    response_format: "b64_json",
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...provider.headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Image generation API error (${response.status}): ${errorText || response.statusText}`,
    );
  }

  const result = (await response.json()) as OpenAIImageResponse;

  if (!result.data || result.data.length === 0) {
    throw new Error("Image generation API returned no images");
  }

  return result;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createImageGenerationModule(
  ctx: BackendContext,
  deps: { ilink: IlinkState },
): ImageGenerationModule {
  const { storage } = ctx;

  function getActiveProvider(): ImageGenerationProviderInfo {
    const settings = storage.getSettings();
    const provider = settings.imageGeneration?.find((p) => p.active);
    if (!provider) {
      throw new Error(
        "No active image generation provider configured. Please configure one in Settings → Image Generation.",
      );
    }
    return provider;
  }

  async function generateImage(
    sessionId: string,
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const provider = getActiveProvider();

    // Call the API
    const apiResult = await callOpenAICompatibleApi(provider, request);

    // Save to share directory
    const shareDir = storage.sessionShareDir(sessionId);
    if (!shareDir) throw new Error(`Session not found: ${sessionId}`);

    const shareId = randomUUID();
    const targetDir = join(shareDir, shareId);

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const images: ImageGenerationImage[] = [];
    const filePaths: string[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < apiResult.data.length; i++) {
      const item = apiResult.data[i];
      const buffer = await fetchImageBuffer(item);
      const format = detectImageFormat(buffer);

      const fileName =
        apiResult.data.length === 1
          ? `image_${timestamp}.${format.ext}`
          : `image_${timestamp}_${i + 1}.${format.ext}`;

      const targetPath = join(targetDir, fileName);
      await writeFile(targetPath, buffer);

      images.push({
        sharePath: `${shareId}/${fileName}`,
        name: fileName,
        mimeType: format.mimeType,
      });
      filePaths.push(targetPath);
    }

    const respond: ImageGenerationRespond = {
      images,
      model: provider.model,
      size: request.size,
      prompt: request.prompt,
    };

    // Queue for iLink forwarding (send generated images to WeChat)
    const ilinkBridge = deps.ilink.getBridge();
    const ilinkActiveSessionId = deps.ilink.getActiveSessionId();
    if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
      const toUserId = ilinkBridge.userId;
      if (toUserId) {
        for (const { filePath, name, mimeType } of filePaths.map((fp, i) => ({
          filePath: fp,
          name: images[i].name,
          mimeType: images[i].mimeType,
        }))) {
          deps.ilink.appendMediaBuffer({ filePath, name, toUserId, mimeType });
        }
      }
    }

    return { respond, filePaths };
  }

  function registerImageGenerationRoute(server: SocketServer, sessionId: string) {
    server.registry("image-generation/generate", async (payload) => {
      const request = imageGenerationRequestSchema.parse(payload);
      const result = await generateImage(sessionId, request);
      return result;
    });
  }

  function buildImageGenerationMcpServer(options: { projectDir: string; socketPath: string }) {
    return {
      name: "image-generation",
      command: process.execPath,
      args: [
        join(process.scriptsPath, "mcp-image-generation/server.mjs"),
        "--project-dir",
        options.projectDir,
        "--socket-path",
        options.socketPath,
      ],
      env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
    };
  }

  return { generateImage, registerImageGenerationRoute, buildImageGenerationMcpServer };
}
