import { useShallow } from "zustand/react/shallow";
import { useAppStore, type StagedAttachmentInfo } from "../store";
import type { ChatMessage, ToolCallMessage, SubagentMessage } from "./chat-message";
import type { AskUserRequest, SessionInfo } from "../../shared/schema";

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

/**
 * 只订阅 askUserRequests 数组。
 *
 * 不要求 session 出现在 `sessions` 列表里：个人助理是伪会话，没有列表项，但
 * ask-user 请求同样落在自己的 store 桶里。已删除会话的桶会由 sessions-changed 清理，
 * 这里直接信任桶即可。
 */
export function useSessionAskUserRequests(sessionId: string | null): AskUserRequest[] | null {
  return useAppStore(
    useShallow((s) => {
      if (!sessionId) {
        return null;
      }
      const state = s.sessionStates.get(sessionId);
      return state && state.askUserRequests.length > 0 ? state.askUserRequests : null;
    }),
  );
}

/** 只订阅指定 session 的元信息（返回 sessions 数组中的对象引用，供 projectId / cwd / mcpServers 等使用） */
export function useSessionById(sessionId: string | null): SessionInfo | null {
  return useAppStore((s) =>
    sessionId ? (s.sessions.find((session) => session.id === sessionId) ?? null) : null,
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

/** 只订阅历史分段加载状态。 */
export function useSessionHistoryPagination(sessionId: string | null): {
  previousSegmentId?: number;
} {
  return useAppStore(
    useShallow((s) => {
      const state = sessionId ? s.sessionStates.get(sessionId) : undefined;
      return { previousSegmentId: state?.previousHistorySegmentId };
    }),
  );
}
