import { resolve } from "path";
import { readFile } from "fs/promises";
import mime from "mime-types";
import { tool, generateText, type ToolSet } from "ai";
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
      description: `Analyze an image file by reading it and using vision capabilities to understand its content.

Use this when you need to visually understand or analyze image content (e.g., describe what's in the image, extract text from a screenshot, analyze a diagram, identify UI elements, read charts).

For simple metadata queries (dimensions, format), use image_metadata instead.

Provide a specific query describing what you want to know about the image — the more specific the query, the better the analysis.`,
      inputSchema: z.object({
        path: z.string().describe("Absolute or project-relative path to the image file."),
        query: z
          .string()
          .describe(
            "What you want to know about the image. Be specific (e.g., 'Extract all text from this screenshot', 'Describe the UI layout', 'What colors are used in this chart?').",
          ),
      }),
      execute: async ({ path: imgPath, query }, { toolCallId }) => {
        const connection = params.getConnection();

        // Broadcast tool_call start
        if (connection) {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId,
              title: `image_analysis ${imgPath}`,
              kind: "read" as const,
              status: "in_progress",
              rawInput: { path: imgPath, query },
            },
          });
        }

        try {
          // Read and encode image
          const absPath = resolve(params.cwd, imgPath);
          const buffer = await readFile(absPath);
          const base64 = buffer.toString("base64");
          // 通过文件后缀名推断 MIME 类型，无需依赖 sharp（避免原生模块加载问题）
          const mimeType = mime.lookup(absPath) || "image/png";

          // Run internal inference with image as user message content block
          const result = await generateText({
            model: params.getModel(),
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    image: base64,
                    mediaType: mimeType,
                  },
                  {
                    type: "text",
                    text: query,
                  },
                ],
              },
            ],
            abortSignal: params.parentSignal,
            providerOptions: {
              openaiCompatible: {
                thinking: { type: "disabled" },
                enable_thinking: false,
                reasoningEffort: "high",
              },
            },
          });

          const analysisText = result.text || "(no analysis returned)";

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
                    content: { type: "text" as const, text: analysisText },
                  },
                ],
              },
            });
          }

          return analysisText;
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
                    content: { type: "text" as const, text: `Error analyzing image: ${errorText}` },
                  },
                ],
              },
            });
          }

          return `Error analyzing image: ${errorText}`;
        }
      },
    }),
  };
}
