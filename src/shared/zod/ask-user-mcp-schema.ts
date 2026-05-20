import { z } from "zod";

export const askUserRequestSchema = z.object({
  title: z.string().describe("A concise title or summary of the question."),
  description: z.string().describe("Detailed description of what you're asking the user."),
  options: z
    .array(
      z.object({
        value: z.string().describe("The internal value of this option."),
        label: z.string().describe("The human-readable label shown to the user."),
        priority: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(6)
    .describe("List of options the user can choose from."),
  allowCustomInput: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether the user is allowed to enter a custom free-form response."),
});

export const askUserRespondSchema = z.object({
  value: z
    .string()
    .or(z.null())
    .describe("The selected option value, or null if the user did not select an option."),
  reason: z
    .string()
    .or(z.null())
    .describe("The reason for the response, such as 'timeout', 'no_client', or custom input text."),
});
