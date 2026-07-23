import { z } from "zod";

/**
 * Image Generation Provider 配置 schema
 */
export const imageGenerationProviderSchema = z.object({
  id: z.string().describe("Unique identifier for the provider"),
  name: z.string().describe("User-defined name, e.g. 'OpenAI GPT-Image'"),
  provider: z
    .enum(["openai-compatible"])
    .describe("Provider type. Currently only 'openai-compatible' is supported."),
  baseUrl: z
    .string()
    .describe(
      "API base URL, e.g. 'https://api.openai.com/v1'. Request goes to {baseUrl}/images/generations",
    ),
  apiKey: z.string().describe("API authentication key"),
  model: z.string().describe("Model identifier, e.g. 'gpt-image-2', 'dall-e-3'"),
  active: z.boolean().describe("Whether this provider is currently active"),
});

export type ImageGenerationProvider = z.infer<typeof imageGenerationProviderSchema>;

/**
 * image_generation tool 输入 schema
 */
export const imageGenerationRequestSchema = z.object({
  prompt: z.string().describe("Detailed description of the image to generate"),
  size: z
    .string()
    .describe(
      "Image size in 'widthxheight' format. Common sizes: '1024x1024' (square), '1536x1024' (landscape), '1024x1536' (portrait), '1792x1024' (wide landscape), '1024x1792' (tall portrait).",
    ),
  n: z.number().optional().default(1).describe("Number of images to generate (default: 1)"),
});

export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;

/**
 * 单张图片的结果
 */
export const imageGenerationImageSchema = z.object({
  sharePath: z.string().describe("Relative path in the session's share directory"),
  name: z.string().describe("Generated image filename"),
  mimeType: z.string().describe("MIME type of the generated image"),
});

export type ImageGenerationImage = z.infer<typeof imageGenerationImageSchema>;

/**
 * image_generation tool 返回给前端渲染的 respond schema
 */
export const imageGenerationRespondSchema = z.object({
  images: z.array(imageGenerationImageSchema).describe("Generated images"),
  model: z.string().describe("Model used for generation"),
  size: z.string().describe("Image size that was generated"),
  prompt: z.string().describe("The prompt used to generate the image"),
});

export type ImageGenerationRespond = z.infer<typeof imageGenerationRespondSchema>;
