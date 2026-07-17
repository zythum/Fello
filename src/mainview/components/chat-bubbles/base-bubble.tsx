import type { SessionInfo } from "../../../shared/schema";

export interface BaseBubbleProps<T> {
  session: SessionInfo;
  message: T;
  isStreaming?: boolean;
}
