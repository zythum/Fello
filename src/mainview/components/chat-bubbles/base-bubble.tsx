import type { SessionInfo } from "../../../shared/schema";

export interface BaseBubbleProps<T> {
  session: SessionInfo;
  message: T;
  isStreaming?: boolean;
  /** Hides actions that would write to the agent or open session-scoped resources. */
  readOnly?: boolean;
}
