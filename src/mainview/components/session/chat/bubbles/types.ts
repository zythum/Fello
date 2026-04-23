import type { SessionInfo } from "../../../../../shared/schema";

export interface BaseBubbleProps<T> {
  session: SessionInfo;
  message: T;
  prevBubbleRole?: string;
  nextBubbleRole?: string;
  isStreaming?: boolean;
}
