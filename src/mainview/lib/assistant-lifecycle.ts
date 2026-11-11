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

export function queueAssistantNotification(notification: SessionNotificationFelloExt): void {
  assistantHistory.queueNotification(notification);
}

export async function loadAssistantHistory(): Promise<void> {
  await assistantHistory.loadInitial();
}

export function loadPreviousAssistantHistory(): Promise<boolean> {
  return assistantHistory.loadPrevious();
}
