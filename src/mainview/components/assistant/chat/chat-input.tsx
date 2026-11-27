import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Astroid, Gauge, Square } from "lucide-react";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AssistantStatus } from "../../../../shared/schema";
import { assistantProjectId } from "../../../../shared/assistant";
import { request } from "../../../backend";
import { useAppStore } from "../../../store";
import { useSessionDraftInput } from "../../../lib/session-selectors";
import { nodesToMentionText, resolveMentions } from "../../../lib/mention-utils";
import { extractErrorMessage, generateUUID } from "@/lib/utils";
import type { ChatMessage } from "../../../lib/chat-message";
import { ChatTextarea, type ChatTextareaSubmitValue } from "../../chat/chat-textarea";
import { PickerMenu } from "../../chat/picker-menu";
import type { VoiceInputButtonRef } from "../../common/voice-input-button";
import { Button } from "@/components/ui/button";
import { useMessage } from "../../providers/message";
import * as tiks from "@rexa-developer/tiks";

const EMPTY_MODELS: NonNullable<AssistantStatus["models"]>["availableModels"] = [];

/**
 * 个人助理输入区：草稿持久化、发送 / 停止、模型与思考等级下拉。
 *
 * 与 session 的 chat-input 一致：输入草稿挂在 store 上（挂载时恢复、失焦 / 卸载时写回），
 * 发送时先乐观插入用户消息，失败再回滚并提示。
 */
export function AssistantChatInput({
  assistantId,
  assistantName,
  status,
  onStatusChange,
}: {
  assistantId: string;
  assistantName: string;
  status: AssistantStatus | null;
  onStatusChange: (updater: (current: AssistantStatus | null) => AssistantStatus | null) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const projectId = assistantProjectId(assistantId);
  const projectCwd = status?.workspace ?? "";
  const isConnected = status?.connectionStatus === "connected";
  const isStreaming = status?.isStreaming ?? false;
  const isDreaming = status?.dreaming ?? false;
  const availableModels = status?.models?.availableModels ?? EMPTY_MODELS;
  const currentModelId = status?.models?.currentModelId ?? null;
  const availableThoughtLevels = status?.thoughtLevels?.availableThoughtLevels ?? [];
  const currentThoughtLevelId = status?.thoughtLevels?.currentThoughtLevelId ?? null;

  // 分组与二级渲染统一交给 PickerMenu（与会话侧共用一份实现）。
  // 依赖直接取 status 上的稳定引用，避免 `?? []` 产生的临时数组让 memo 每次都失效。
  const modelItems = useMemo(
    () =>
      (status?.models?.availableModels ?? []).map((model) => ({
        id: model.modelId,
        name: model.name,
        description: model.description,
      })),
    [status?.models?.availableModels],
  );
  const thoughtLevelItems = useMemo(
    () =>
      (status?.thoughtLevels?.availableThoughtLevels ?? []).map((level) => ({
        id: level.id,
        name: level.name,
        description: level.description,
      })),
    [status?.thoughtLevels?.availableThoughtLevels],
  );

  // 与 session 的 chat-input 一致：草稿挂在 store 上，挂载时恢复、失焦 / 卸载时写回。
  const draftInput = useSessionDraftInput(assistantId);
  const [input, setInput] = useState(draftInput);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voiceInputRef = useRef<VoiceInputButtonRef>(null);

  // 最新输入值：卸载时就地读取，避免 cleanup 闭包捕获旧值（同 session 的 chat-input）。
  const inputValueRef = useRef(input);
  // eslint-disable-next-line react/refs
  inputValueRef.current = input;

  const saveDraft = useCallback(() => {
    useAppStore
      .getState()
      .updateSessionState(assistantId, () => ({ draftInput: inputValueRef.current }));
  }, [assistantId]);

  // 离开页面（组件卸载）或输入框失焦时暂存草稿。
  useEffect(() => {
    return () => saveDraft();
  }, [saveDraft]);

  useEffect(() => {
    const handleAddToChat = (event: Event) => {
      const nodes = (event as CustomEvent<{ id: string; name: string; isFolder: boolean }[]>)
        .detail;
      if (!nodes || nodes.length === 0) return;
      const mentions = nodesToMentionText(nodes);
      setInput((prev) => (prev ? `${prev} ${mentions} ` : `${mentions} `));
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    document.addEventListener("fello-add-to-chat", handleAddToChat);
    return () => document.removeEventListener("fello-add-to-chat", handleAddToChat);
  }, []);

  const send = useCallback(
    async (value: ChatTextareaSubmitValue) => {
      // 与会话一致：提交前先停止语音输入，避免识别结果插回已清空的输入框。
      await voiceInputRef.current?.stop();
      const text = resolveMentions(value.text).trim();
      if (!text) return;
      if (!isConnected) {
        toast.error(t("assistant.notConnected", "Personal Assistant is not connected."));
        return;
      }
      if (isDreaming) {
        toast.error(t("assistant.busyDreaming", "Wait for Dream to finish."));
        return;
      }
      // 与会话一致：语音面板发送允许打断当前生成；普通输入框仍要求等本轮结束。
      if (isStreaming) {
        if (value.source !== "voice") {
          toast.error(t("assistant.busyStreaming", "Wait for the current reply to finish."));
          return;
        }
        await request.cancelPrompt({ sessionId: assistantId });
      }
      tiks.click();
      setInput("");
      useAppStore.getState().updateSessionState(assistantId, () => ({ draftInput: "" }));
      // Same as Session: show the message at once with optimistic ids. The backend's copy
      // carries the same optimistic_id and replaces this one when it arrives.
      const displayId = generateUUID();
      const contents: ContentBlock[] = [
        {
          type: "text",
          text,
          _meta: { display_id: displayId, optimistic_id: generateUUID() },
        },
      ];
      useAppStore.getState().addMessage(assistantId, {
        role: "user_message",
        contents,
        displayId,
        receivedAt: Date.now(),
      } satisfies ChatMessage);
      document.dispatchEvent(
        new CustomEvent("fello-scroll-to-bottom", { detail: { duration: 0 } }),
      );
      try {
        const result = await request.sendPrompt({ sessionId: assistantId, contents });
        const finishedNormally =
          result.stopReason === "end_turn" || result.stopReason === "cancelled";
        if (result.error || !finishedNormally) {
          // 失败只做一次性提示，不再写进 assistant status：状态里留一份会让 header 长期挂着旧错误。
          const message =
            result.error || result.stopReason || t("assistant.failed", "Assistant failed");
          toast.error(message);
        }
      } catch (error) {
        // The message never reached the backend, so drop the optimistic copy (matched by its displayId).
        useAppStore.getState().updateSessionState(assistantId, (state) => ({
          messages: state.messages.filter((message) => message.displayId !== displayId),
        }));
        onStatusChange((current) => ({
          ...(current ?? {
            models: null,
            thoughtLevels: null,
            sourceAgentId: null,
            workspace: "",
          }),
          connectionStatus: "error",
          error: error instanceof Error ? error.message : String(error),
          sourceAgentId: null,
          enabled: true,
          isStreaming: false,
          dreaming: false,
        }));
      }
    },
    [assistantId, isConnected, isStreaming, isDreaming, t, toast, onStatusChange],
  );

  const changeModel = useCallback(
    async (modelId: string) => {
      if (modelId === currentModelId) return;
      // 与会话一致：本地先切勾选（乐观），失败回滚。模型切换失败不等于助理掉线，
      // 所以只用 toast 提示，不再把整个 status 置成 error。
      const previousModels = status?.models ?? null;
      onStatusChange((current) =>
        current?.models
          ? { ...current, models: { ...current.models, currentModelId: modelId } }
          : current,
      );
      try {
        await request.setModel({ sessionId: assistantId, modelId });
      } catch (error) {
        onStatusChange((current) => (current ? { ...current, models: previousModels } : current));
        toast.error(
          extractErrorMessage(error) || t("assistant.modelUpdateFailed", "Failed to switch model."),
        );
      }
    },
    [assistantId, currentModelId, onStatusChange, status?.models, t, toast],
  );

  const changeThoughtLevel = useCallback(
    async (thoughtLevelId: string) => {
      if (thoughtLevelId === currentThoughtLevelId) return;
      const previousLevels = status?.thoughtLevels ?? null;
      onStatusChange((current) =>
        current?.thoughtLevels
          ? {
              ...current,
              thoughtLevels: { ...current.thoughtLevels, currentThoughtLevelId: thoughtLevelId },
            }
          : current,
      );
      try {
        await request.setThoughtLevel({ sessionId: assistantId, thoughtLevelId });
      } catch (error) {
        onStatusChange((current) =>
          current ? { ...current, thoughtLevels: previousLevels } : current,
        );
        toast.error(
          extractErrorMessage(error) ||
            t("assistant.thoughtLevelUpdateFailed", "Failed to switch thinking level."),
        );
      }
    },
    [assistantId, currentThoughtLevelId, onStatusChange, status?.thoughtLevels, t, toast],
  );

  return (
    <div className="-mt-6 relative p-6 transition-opacity duration-300">
      <div className="mx-auto max-w-5xl">
        <ChatTextarea
          sessionId={assistantId}
          projectId={projectId}
          projectCwd={projectCwd}
          className="shadow-[0_0_20px] shadow-primary/10 dark:shadow-primary/20"
          textValue={input}
          onTextValueChange={setInput}
          inputRef={inputRef}
          onBlur={saveDraft}
          onSubmit={(value) => void send(value)}
          placeholder={t("assistant.placeholder", "Message {{name}} (Enter to send)", {
            name: assistantName,
          })}
          voiceInputRef={voiceInputRef}
          attachments={null}
          rightSlot={
            <>
              {availableModels.length > 0 && (
                <PickerMenu
                  items={modelItems}
                  currentId={currentModelId}
                  onSelect={(modelId) => void changeModel(modelId)}
                  icon={Astroid}
                  fallbackLabel={t("assistant.selectModel", "Model")}
                  align="end"
                />
              )}
              {availableThoughtLevels.length > 0 && (
                <PickerMenu
                  items={thoughtLevelItems}
                  currentId={currentThoughtLevelId}
                  onSelect={(levelId) => void changeThoughtLevel(levelId)}
                  icon={Gauge}
                  fallbackLabel={t("assistant.selectThinking", "Thinking")}
                  align="end"
                  buttonClassName="max-w-32"
                />
              )}
            </>
          }
          primaryAction={
            isStreaming ? (
              <Button
                variant="destructive"
                size="icon"
                className="size-7 cursor-default rounded-lg"
                onClick={() => void request.cancelPrompt({ sessionId: assistantId })}
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-7 rounded-lg"
                disabled={!input.trim() || !isConnected}
                onClick={() => void send({ text: input, attachments: [], source: "input" })}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )
          }
        />
      </div>
    </div>
  );
}
