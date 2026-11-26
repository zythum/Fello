import { Check, HatGlasses, HelpCircle, LoaderCircle, TriangleAlert } from "lucide-react";
import { useAppStore } from "../../store";

/**
 * 会话行状态图标。
 *
 * 单独成组件并按 session 精确订阅（只取一个原始值 kind），避免 Sidebar 订阅整个
 * sessionStates——流式期间每个 token 都会更新 sessionStates，全量订阅会让整个侧边栏
 * 每帧重渲染。只有当该会话的状态真正发生变化时，这个图标才会重渲染。
 */
export function SessionRowStatus({
  sessionId,
  isStreaming,
}: {
  sessionId: string;
  isStreaming: boolean;
}) {
  const kind = useAppStore((s) => {
    const state = s.sessionStates.get(sessionId);
    if ((state?.askUserRequests?.length ?? 0) > 0) return "ask";
    if (state?.completedStatus === "error") return "error";
    if (state?.completedStatus === "success") return "success";
    if (state?.completedAt) return "success";
    return "none";
  });

  if (kind === "ask") return <HelpCircle className="size-3 shrink-0 text-sky-500" />;
  if (isStreaming) return <LoaderCircle className="size-3 animate-spin shrink-0" />;
  if (kind === "success") return <Check className="size-3 shrink-0 text-green-500" />;
  if (kind === "error") return <TriangleAlert className="size-3 shrink-0 text-yellow-500" />;
  return <div className="size-3 shrink-0" />;
}

/**
 * 个人助理行图标：默认是 HatGlasses（区别于会话行的空图标占位），
 * 有 pending 的 ask-user 请求时换成问号，与会话行的提示语义一致。
 * 助理的流式 / 完成状态没有进入全局 store，因此这里不展示加载与完成图标。
 */
export function AssistantRowStatus({
  assistantId,
  disabled,
  isActive,
}: {
  assistantId: string;
  disabled: boolean;
  isActive: boolean;
}) {
  const kind = useAppStore((s) => {
    const state = s.sessionStates.get(assistantId);
    if ((state?.askUserRequests?.length ?? 0) > 0) return "ask";
    if (state?.completedStatus === "error") return "error";
    if (state?.completedStatus === "success") return "success";
    return "none";
  });
  const status = useAppStore((s) => s.assistantStatuses.get(assistantId));

  if (disabled) return <HatGlasses className="size-3 shrink-0" />;
  if (kind === "ask") return <HelpCircle className="size-3 shrink-0 text-sky-500" />;
  if (status?.isStreaming || status?.dreaming) {
    return <LoaderCircle className="size-3 animate-spin shrink-0" />;
  }
  // 当前正在看的助理不显示完成状态，与 session 的侧边栏语义一致。
  if (isActive) return <HatGlasses className="size-3 shrink-0" />;
  if (kind === "success") return <Check className="size-3 shrink-0 text-green-500" />;
  if (kind === "error") return <TriangleAlert className="size-3 shrink-0 text-yellow-500" />;
  return <HatGlasses className="size-3 shrink-0" />;
}
