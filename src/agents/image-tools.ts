import { resolve } from "path";
import { readFile } from "fs/promises";
import mime from "mime-types";
import { tool, generateText, type FilePart, type TextPart, type ToolSet } from "ai";
import type { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import type { AgentClientProxy } from "./agent-client-proxy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageAnalysisToolParams = {
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createImageAnalysisTool(params: ImageAnalysisToolParams): ToolSet {
  return {
    ImageAnalysis: tool({
      description: `Analyze one or more image files by reading them and using vision capabilities to understand their content.

Use this when you need to visually understand or analyze image content (e.g., describe what's in the image, extract text from a screenshot, analyze a diagram, identify UI elements, read charts). Pass every image that belongs to the same question in a single call (up to 10 per call) so the model can compare them: each image carries a name that labels it in the request, so you can refer to that name in the query and attribute the findings in the answer.

For simple metadata queries (dimensions, format), use image_metadata instead.

Provide a specific query describing what you want to know about the images — the more specific the query, the better the analysis.`,
      inputSchema: z.object({
        images: z
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
          .describe(
            "Images to analyze together, in order. Min 1, max 10 — every image is sent to the model in the same request, so split larger batches into several calls.",
          ),
        query: z
          .string()
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
          // Read and encode every image. One unreadable image must not discard
          // the analysis of the others, so failures are collected separately.
          const content: Array<TextPart | FilePart> = [];
          const failures: string[] = [];
          for (const image of images) {
            try {
              const absPath = resolve(params.cwd, image.path);
              const buffer = await readFile(absPath);
              // 通过文件后缀名推断 MIME 类型，无需依赖 sharp（避免原生模块加载问题）
              const mimeType = mime.lookup(absPath) || "image/png";
              // 图片前插入一行 name 标签，让模型能区分并引用具体图片
              content.push({ type: "text", text: `Image "${image.name}":` });
              content.push({
                type: "file",
                data: buffer.toString("base64"),
                mediaType: mimeType,
              });
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              failures.push(`${image.name} (${image.path}): ${reason}`);
            }
          }

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
          const errorText = error instanceof Error ? error.message : String(error);

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
    }),
  };
}
