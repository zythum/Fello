import { ASSISTANT_SESSION_ID } from "../../assistant/constants";
import type { SessionNotificationFelloExt } from "../../shared/schema";
import { request } from "../backend";
import { createNotificationHistoryController } from "./notification-history";

const assistantHistory = createNotificationHistoryController({
  sessionId: ASSISTANT_SESSION_ID,
  loadSegment: (segmentId) =>
    request.getAssistantHistorySegment(segmentId === undefined ? {} : { segmentId }),
  initialLoadError: () => new Error("Assistant history is unavailable."),
  previousLoadError: () => new Error("Assistant history segment is unavailable."),
});

// Notifications arrive one IPC message at a time during streaming. Writing each one to the
// store right away forces a synchronous re-render per chunk and can exceed React's update
// depth limit. Buffer them and write once per frame, the same way Project Sessions does.
let pendingNotifications: SessionNotificationFelloExt[] = [];
let flushFrameId: number | null = null;

function flushPendingNotifications(): void {
  flushFrameId = null;
  const batch = pendingNotifications;
  pendingNotifications = [];
  assistantHistory.queueNotifications(batch);
}

export function queueAssistantNotification(notification: SessionNotificationFelloExt): void {
  pendingNotifications.push(notification);
  if (flushFrameId == null) {
    flushFrameId = requestAnimationFrame(flushPendingNotifications);
  }
}

export async function loadAssistantHistory(): Promise<void> {
  await assistantHistory.loadInitial();
}

export function loadPreviousAssistantHistory(): Promise<boolean> {
  return assistantHistory.loadPrevious();
}
