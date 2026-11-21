import { tool } from "ai";
import { z } from "zod";
import { runWithToolUpdates, type ToolUpdateSender } from "../tool-updates";
import { serverTimeZone, type ReminderListFilter, type ReminderService, type ReminderView } from "./service";
import type { ReminderTrigger } from "./store";
import { occurrencesBetween } from "../../shared/reminder";

/** Trigger times returned by reminder_occurrences in one call. Keeps the tool result small. */
const MAX_OCCURRENCES_RESULT = 99;

function formatLocal(ms: number): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${(parts.timeZoneName ?? "").replace("GMT", "UTC")})`;
}

function describeTrigger(trigger: ReminderTrigger): string {
  return trigger.type === "once" ? `once at ${formatLocal(trigger.at)}` : `cron ${trigger.expr}`;
}

/** The shape the model sees. Times are ISO strings so the model can read them unambiguously. */
function toToolResult(reminder: ReminderView) {
  const lastFiredAt = reminder.firedAt.at(-1) ?? null;
  return {
    id: reminder.id,
    text: reminder.text,
    disabled: reminder.disabled,
    trigger: reminder.trigger,
    nextRunAt: reminder.nextRunAt === null ? null : new Date(reminder.nextRunAt).toISOString(),
    lastFiredAt: lastFiredAt === null ? null : new Date(lastFiredAt).toISOString(),
    firedAt: reminder.firedAt.map((ms) => new Date(ms).toISOString()),
  };
}

function parseIsoTime(value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid time: ${value}. Use ISO 8601 with an offset, for example 2026-11-20T15:00:00+08:00.`);
  return ms;
}

function summarize(reminder: Pick<ReminderView, "text" | "disabled" | "trigger">): string {
  return `${reminder.text} (${reminder.disabled ? "disabled" : "active"}, ${describeTrigger(reminder.trigger)})`;
}

const timeInputs = {
  at: z
    .string()
    .optional()
    .describe("One-time reminder time in ISO 8601 with an offset, for example 2026-11-20T15:00:00+08:00."),
  cron: z
    .string()
    .optional()
    .describe("Recurring reminder as a 5-field cron expression in local time, for example 0 9 * * 1-5."),
};

export function createReminderTools({
  service,
  sendUpdate,
}: {
  service: ReminderService;
  sendUpdate: ToolUpdateSender;
}) {
  return {
    reminder_create: tool({
      description:
        "Create a reminder. It is delivered as a message in this chat at the given time. Give either at (one time) or cron (recurring). Create reminders only when the user asks for one.",
      inputSchema: z.object({
        text: z.string().trim().min(1).max(500).describe("What to remind the user about."),
        ...timeInputs,
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Create reminder: ${input.text}`, kind: "edit", rawInput: input },
          async () => {
            const reminder = await service.create({
              text: input.text,
              at: input.at === undefined ? undefined : parseIsoTime(input.at),
              cron: input.cron,
            });
            return toToolResult(reminder);
          },
          (result) => `Created: ${result.text}`,
        ),
    }),

    reminder_list: tool({
      description:
        "List reminders. By default this returns active reminders (not disabled and still able to fire). Use status past for one-time reminders whose time has passed, or all for everything. Call this before update or delete to get the exact id.",
      inputSchema: z.object({
        status: z
          .enum(["upcoming", "past", "all"])
          .optional()
          .describe(
            "upcoming (default): active reminders. past: one-time reminders that fired or are overdue. all: every reminder.",
          ),
        from: z
          .string()
          .optional()
          .describe("Only reminders with a trigger time at or after this ISO 8601 time, with an offset."),
        to: z
          .string()
          .optional()
          .describe("Only reminders with a trigger time before this ISO 8601 time, with an offset."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `List reminders (${input.status ?? "upcoming"})`, kind: "read", rawInput: input },
          async () => {
            const filter: ReminderListFilter = input.status ?? "upcoming";
            const listed = service.list(filter);
            if (input.from === undefined && input.to === undefined) {
              return { reminders: listed.map(toToolResult) };
            }
            const start = input.from === undefined ? 0 : parseIsoTime(input.from);
            const end = input.to === undefined ? Number.MAX_SAFE_INTEGER : parseIsoTime(input.to);
            const reminders = listed
              .filter((reminder) => occurrencesBetween(reminder, start, end, serverTimeZone(), 1).length > 0)
              .map(toToolResult);
            return { reminders };
          },
          (result) => {
            const filter = input.status ?? "upcoming";
            if (result.reminders.length === 0) return `No ${filter} reminders found.`;
            const texts = result.reminders.map((reminder) => reminder.text).join("; ");
            return `Found ${result.reminders.length} ${filter} reminder(s): ${texts}`;
          },
        ),
    }),

    reminder_update: tool({
      description:
        "Change a reminder's text, its time, or whether it is enabled. Use reminder_list first to find the id. Only change a reminder the user asked to change. Setting a new time reactivates a fired or missed reminder.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Reminder id from reminder_list."),
        text: z.string().trim().min(1).max(500).optional(),
        ...timeInputs,
        enabled: z.boolean().optional().describe("false pauses the reminder. true resumes a paused one."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Update reminder ${input.id}`, kind: "edit", rawInput: input },
          async () => {
            const reminder = await service.update(input.id, {
              text: input.text,
              at: input.at === undefined ? undefined : parseIsoTime(input.at),
              cron: input.cron,
              enabled: input.enabled,
            });
            return toToolResult(reminder);
          },
          (result) => `Updated: ${summarize(result)}`,
        ),
    }),

    reminder_occurrences: tool({
      description:
        "List the exact trigger times of one reminder between from and to. Use this for a recurring reminder to see its times in a period. Use reminder_list first to get the id.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Reminder id from reminder_list."),
        from: z.string().describe("Start of the period, ISO 8601 with an offset. Inclusive."),
        to: z.string().describe("End of the period, ISO 8601 with an offset. Exclusive."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Trigger times of reminder ${input.id}`, kind: "read", rawInput: input },
          async () => {
            const reminder = service.get(input.id);
            if (!reminder) {
              throw new Error(`Reminder ${input.id} does not exist.`);
            }
            const start = parseIsoTime(input.from);
            const end = parseIsoTime(input.to);
            if (end <= start) throw new Error("The end time must be after the start time.");
            const times = occurrencesBetween(reminder, start, end, serverTimeZone(), MAX_OCCURRENCES_RESULT + 1);
            return {
              id: reminder.id,
              text: reminder.text,
              occurrences: times.slice(0, MAX_OCCURRENCES_RESULT).map((ms) => new Date(ms).toISOString()),
              truncated: times.length > MAX_OCCURRENCES_RESULT,
            };
          },
          (result) => `${result.text}: ${result.occurrences.length} trigger time(s)${result.truncated ? ", more not shown" : ""}`,
        ),
    }),

    reminder_delete: tool({
      description:
        "Delete a reminder permanently. Use reminder_list first to find the id. Only delete when the user explicitly asks.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Reminder id from reminder_list."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Delete reminder ${input.id}`, kind: "edit", rawInput: input },
          async () => {
            await service.delete(input.id);
            return { id: input.id, deleted: true };
          },
          () => `Deleted reminder ${input.id}`,
        ),
    }),
  };
}
