import { useShallow } from "zustand/react/shallow";
import { useAppStore, type StagedAttachmentInfo } from "../store";
import type { ChatMessage, ToolCallMessage, SubagentMessage } from "./chat-message";
import type { AskUserRequest } from "../../shared/schema";
import type { AvailableCommand, Usage, UsageUpdate } from "@agentclientprotocol/sdk";

/**
 * 细粒度的 Session State Selector Hooks。
 *
 * 每个 hook 只订阅 state 树中的特定切片，避免组件因无关字段的变更而重渲染。
 * 组件应优先使用这些 hook 而非 useSessionState() + 解构。
 */

/** 只订阅 messages 数组 */
export function useSessionMessages(sessionId: string | null): ChatMessage[] | null {
  return useAppStore((s) => {
    const state = sessionId ? s.sessionStates.get(sessionId) : undefined;
    return state?.messages ?? null;
  });
}

/** 只订阅 activeToolCalls map */
export function useSessionActiveToolCalls(
  sessionId: string | null,
): Map<string, ToolCallMessage> | null {
  return useAppStore((s) => {
    const state = sessionId ? s.sessionStates.get(sessionId) : undefined;
    return state?.activeToolCalls ?? null;
  });
}

/** 只订阅 activeSubagents map */
export function useSessionActiveSubagents(
  sessionId: string | null,
): Map<string, SubagentMessage> | null {
  return useAppStore((s) => {
    const state = sessionId ? s.sessionStates.get(sessionId) : undefined;
    return state?.activeSubagents ?? null;
  });
}

/** 只订阅 isLoading boolean */
export function useSessionIsLoading(sessionId: string | null): boolean {
  return useAppStore((s) => {
    const state = sessionId ? s.sessionStates.get(sessionId) : undefined;
    return state?.isLoading ?? false;
  });
}

/** 只订阅 askUserRequests 数组 */
export function useSessionAskUserRequests(sessionId: string | null): AskUserRequest[] | null {
  return useAppStore(
    useShallow((s) => {
      if (!sessionId) {
        return null;
      }
      const session = s.sessions.find((session) => session.id === sessionId);
      if (session) {
        const state = s.sessionStates.get(session.id);
        if (state && state.askUserRequests.length > 0) {
          return state.askUserRequests;
        }
      }
      return null;
    }),
  );
}

/** 只订阅 draftInput 字符串 */
export function useSessionDraftInput(sessionId: string | null): string {
  return useAppStore((s) => {
    const state = sessionId ? s.sessionStates.get(sessionId) : undefined;
    return state?.draftInput ?? "";
  });
}

/** 只订阅 draftAttachments 数组 */
export function useSessionDraftAttachments(sessionId: string | null): StagedAttachmentInfo[] {
  return useAppStore(
    useShallow((s) => {
      const state = sessionId ? s.sessionStates.get(sessionId) : undefined;
      return state?.draftAttachments ?? [];
    }),
  );
}

/** 订阅 usage & lastTurnUsage（用 useShallow 做浅比较，避免因对象重建而误触发重渲染） */
export function useSessionUsage(sessionId: string | null): {
  usage: UsageUpdate | null;
  lastTurnUsage: Usage | null;
} {
  return useAppStore(
    useShallow((s) => {
      const state = sessionId ? s.sessionStates.get(sessionId) : undefined;
      if (!state) return { usage: null, lastTurnUsage: null };
      return { usage: state.usage, lastTurnUsage: state.lastTurnUsage };
    }),
  );
}

/** 只订阅 availableCommands 数组 */
export function useSessionAvailableCommands(sessionId: string | null): AvailableCommand[] {
  return useAppStore(
    useShallow((s) => {
      const state = sessionId ? s.sessionStates.get(sessionId) : undefined;
      return state?.availableCommands ?? [];
    }),
  );
}
