import { useEffect } from "react";
import { subscribe, type BackendEvents } from "../../backend";
import { useTtsPrefsStore } from "./tts-prefs";
import { endTtsStream, feedTtsStream, leaveTtsSession, resetTtsForNewPrompt } from "./tts-reader";

/**
 * 流式自动朗读：**属于某个会话**的订阅。
 *
 * 由 session 视图（`Chat`）持有，而不是挂在 App 上：
 * - 同一时刻只有一个 session 视图挂载，所以「唯一的流式自动朗读」是结构性保证，
 *   不需要再去比对「当前激活会话」
 * - 切会话（`sessionId` 变化）或视图卸载时，cleanup 直接结束当前朗读 —— 朗读的生命周期
 *   和视图生命周期对齐
 *
 * 只朗读本会话的顶层 agent 消息（subagent 与思考过程跳过）；开关取自渲染层偏好
 * （localStorage: `fello.tts.prefs.autoRead`），关掉即整体静默。
 *
 * 互斥（与手动朗读、新一轮 prompt 共用同一条播放通道）：
 * - 切会话 / 卸载 → `leaveTtsSession()`：停声 + 清掉本轮残留状态（切回来还能读）
 * - 用户发起新一轮（`prompt-start`）→ 停掉上一轮还在响的声音，新一轮恢复自动朗读
 * - 用户手动朗读某条回复 → 手动朗读接麦，本轮自动朗读让位（`speakOnce` 里抑制）
 * - 用户点「停止朗读」→ 停到本轮结束（`prompt-end` 时恢复）
 */
export function useTtsAutoRead(sessionId: string): void {
  useEffect(() => {
    const handleSessionUpdate = (detail: BackendEvents["session-update"]) => {
      if (detail.sessionId !== sessionId) return;
      if (!useTtsPrefsStore.getState().autoRead) return;
      const { notification } = detail;
      const update = notification.update;
      if (update.sessionUpdate !== "agent_message_chunk") return;
      // subagent 的消息 notification.sessionId（ACP 侧）!= 本会话 resumeId
      const resumeId = sessionId.slice(sessionId.indexOf(":") + 1);
      if (notification.sessionId !== resumeId) return;
      if (update.content.type !== "text") return;
      const text = update.content.text;
      if (!text) return;

      feedTtsStream(sessionId, text);
    };

    const handlePromptStart = (detail: BackendEvents["prompt-start"]) => {
      if (detail.sessionId !== sessionId) return;
      // 新的一轮：停掉上一轮残留的声音，新一轮恢复朗读
      resetTtsForNewPrompt(sessionId);
    };

    const handlePromptEnd = (detail: BackendEvents["prompt-end"]) => {
      if (detail.sessionId !== sessionId) return;
      endTtsStream(sessionId);
    };

    subscribe.on("session-update", handleSessionUpdate);
    subscribe.on("prompt-start", handlePromptStart);
    subscribe.on("prompt-end", handlePromptEnd);
    return () => {
      subscribe.off("session-update", handleSessionUpdate);
      subscribe.off("prompt-start", handlePromptStart);
      subscribe.off("prompt-end", handlePromptEnd);
      // 切会话 / 卸载：停掉本会话的声音，并清掉本轮残留状态（抑制记录等），
      // 这样切回来时后续文本还能正常朗读
      leaveTtsSession();
    };
  }, [sessionId]);
}
