import { useEffect } from "react";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";

/**
 * 打开/挂载时若 store 中还没有上下文时间线，则从后端一次性拉取。
 * 覆盖 app reload、session 缓存加载等场景（实时更新仍走 context-update 事件）。
 */
export function useSeedContext(sessionId: string | null, enabled = true): void {
  useEffect(() => {
    if (!sessionId || !enabled) return;
    const store = useAppStore.getState();
    const state = store.getSessionState(sessionId);
    if (state.contextTimeline.length > 0) return;
    request
      .getContextTimeline({ sessionId })
      .then((res) => {
        if (!res || (res.timeline.length === 0 && res.events.length === 0)) return;
        store.updateSessionState(sessionId, (s) => {
          const existing = new Set(s.contextTimeline.map((x) => x.stepId));
          const mergedTimeline = [
            ...s.contextTimeline,
            ...res.timeline.filter((x) => !existing.has(x.stepId)),
          ];
          const knownEventIds = new Set(s.contextEvents.map((e) => e.id));
          const mergedEvents = [
            ...s.contextEvents,
            ...res.events.filter((e) => !knownEventIds.has(e.id)),
          ];
          return { contextTimeline: mergedTimeline, contextEvents: mergedEvents };
        });
      })
      .catch(() => {});
  }, [sessionId, enabled]);
}
