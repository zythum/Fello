import { tool } from "ai";
import { z } from "zod";
import { runWithToolUpdates, type ToolUpdateSender } from "./tool-updates";

export type AskUserToolOption = {
  value: string;
  label: string;
  priority: "high" | "medium" | "low";
  danger?: boolean;
};

export type AskUserToolOptions = {
  title: string;
  description: string;
  options: AskUserToolOption[];
  allowCustomInput?: boolean;
};

export type AskUserToolResult = { value: string | null; reason: string | null };

export type AskUserFn = (options: AskUserToolOptions) => Promise<AskUserToolResult>;

/** Asks the user directly. `reason` carries free-form input or the timeout marker. */
export function createAskUserTool({
  askUser,
  sendUpdate,
}: {
  askUser: AskUserFn;
  sendUpdate: ToolUpdateSender;
}) {
  return tool({
    description:
      "Ask the user a question and wait for the answer. Use it when a decision or missing information blocks you, especially before writing outside your workspace or acting on a worker's permission request. Returns the chosen option value, the user's free-form reply, or null when the user did not answer.",
    inputSchema: z.object({
      title: z.string().trim().min(1).max(200).describe("Short question title."),
      description: z
        .string()
        .max(4_000)
        .describe("Details the user needs to answer, for example the command or file involved."),
      options: z
        .array(
          z.object({
            value: z.string().min(1).max(100).describe("Value returned when chosen."),
            label: z.string().min(1).max(200).describe("Label shown to the user."),
            priority: z
              .enum(["high", "medium", "low"])
              .describe("Visual priority of the option."),
            danger: z.boolean().optional().describe("Mark the option as destructive."),
          }),
        )
        .max(6)
        .describe("Options to offer. May be empty when only free-form input makes sense."),
      allowCustomInput: z
        .boolean()
        .optional()
        .describe("Allow a free-form reply in addition to the options. Default true."),
    }),
    execute: async (input, { toolCallId }) =>
      runWithToolUpdates(
        sendUpdate,
        {
          toolCallId,
          title: `Ask user: ${input.title}`,
          kind: "other",
          rawInput: { title: input.title, options: input.options.map((option) => option.value) },
        },
        async () => {
          const result = await askUser({
            title: input.title,
            description: input.description,
            options: input.options,
            allowCustomInput: input.allowCustomInput,
          });
          const timedOut = result.reason === "timeout";
          const answer = timedOut
            ? null
            : result.value !== null
              ? result.value
              : result.reason;
          return { answer, timedOut, selected: result.value };
        },
        (result) => {
          if (result.timedOut) return "The user did not answer (timeout).";
          if (result.answer === null) return "The user cancelled.";
          return `User answered: ${result.answer}`;
        },
      ),
  });
}
