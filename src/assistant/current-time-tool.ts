import { tool } from "ai";
import { z } from "zod";
import type { SessionNotification } from "@agentclientprotocol/sdk";

/** Sends a tool_call or tool_call_update to the assistant's UI. */
export type ToolUpdateSender = (update: SessionNotification["update"]) => Promise<void>;

const LOCAL_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "long",
  timeZoneName: "longOffset",
};

function formatInZone(now: Date, timeZone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { ...LOCAL_TIME_FORMAT, timeZone });
  } catch {
    throw new Error(`Unknown time zone: ${timeZone}. Use an IANA name such as Asia/Shanghai.`);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const offset = (parts.timeZoneName ?? "GMT").replace(/^GMT/, "");
  return {
    local: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: parts.weekday,
    utcOffset: offset || "+00:00",
  };
}

function readCurrentTime(timeZone: string | undefined) {
  const now = new Date();
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    iso: now.toISOString(),
    timeZone: zone,
    ...formatInZone(now, zone),
  };
}

export function createCurrentTimeTool({ sendUpdate }: { sendUpdate: ToolUpdateSender }) {
  return tool({
    description:
      "Get the current date and time. Pass timeZone as an IANA name such as Asia/Shanghai to get the time in that zone. Omit timeZone to use the computer's local zone.",
    inputSchema: z.object({
      timeZone: z
        .string()
        .min(1)
        .max(64)
        .optional()
        .describe("IANA time zone name, for example Asia/Shanghai. Omit for the local zone."),
    }),
    execute: async ({ timeZone }, { toolCallId }) => {
      await sendUpdate({
        sessionUpdate: "tool_call",
        toolCallId,
        title: timeZone ? `Current time in ${timeZone}` : "Current time",
        kind: "other",
        status: "in_progress",
        rawInput: { timeZone },
      });
      try {
        const result = readCurrentTime(timeZone);
        await sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: `${result.local} ${result.weekday} (${result.timeZone}, UTC${result.utcOffset})`,
              },
            },
          ],
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: message } }],
        });
        throw error;
      }
    },
  });
}
