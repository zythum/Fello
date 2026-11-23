import type { SessionNotificationFelloExt } from "../../shared/schema";
import { request } from "../backend";
import { createNotificationHistoryController } from "./notification-history";

type Entry = {
  history: ReturnType<typeof createNotificationHistoryController>;
  pendingNotifications: SessionNotificationFelloExt[];
  flushFrameId: number | null;
};

const entries = new Map<string, Entry>();

function entryFor(assistantId: string): Entry {
  const existing = entries.get(assistantId);
  if (existing) return existing;

  const history = createNotificationHistoryController({
    sessionId: assistantId,
    loadSegment: (segmentId) =>
      request.getAssistantHistorySegment(
        segmentId === undefined ? { assistantId } : { assistantId, segmentId },
      ),
    initialLoadError: () => new Error("Assistant history is unavailable."),
    previousLoadError: () => new Error("Assistant history segment is unavailable."),
  });

  // Notifications arrive one IPC message at a time during streaming. Writing each one to the
  // store right away forces a synchronous re-render per chunk and can exceed React's update
  // depth limit. Buffer them and write once per frame, the same way Project Sessions does.
  const entry: Entry = { history, pendingNotifications: [], flushFrameId: null };
  entries.set(assistantId, entry);
  return entry;
}

function flushPendingNotifications(assistantId: string): void {
  const entry = entries.get(assistantId);
  if (!entry) return;
  entry.flushFrameId = null;
  const batch = entry.pendingNotifications;
  entry.pendingNotifications = [];
  entry.history.queueNotifications(batch);
}

export function queueAssistantNotification(
  assistantId: string,
  notification: SessionNotificationFelloExt,
): void {
  const entry = entryFor(assistantId);
  entry.pendingNotifications.push(notification);
  if (entry.flushFrameId == null) {
    entry.flushFrameId = requestAnimationFrame(() => flushPendingNotifications(assistantId));
  }
}

export async function loadAssistantHistory(assistantId: string): Promise<void> {
  await entryFor(assistantId).history.loadInitial();
}

export function loadPreviousAssistantHistory(assistantId: string): Promise<boolean> {
  return entryFor(assistantId).history.loadPrevious();
}

/** Drop buffered history state when an assistant is deleted. */
export function disposeAssistantHistory(assistantId: string): void {
  const entry = entries.get(assistantId);
  if (!entry) return;
  if (entry.flushFrameId != null) cancelAnimationFrame(entry.flushFrameId);
  entries.delete(assistantId);
}
