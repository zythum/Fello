import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Astroid, Check, ChevronDown, Gauge, Square } from "lucide-react";
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
import type { VoiceInputButtonRef } from "../../common/voice-input-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const currentModel = availableModels.find((model) => model.modelId === currentModelId);
  const availableThoughtLevels = status?.thoughtLevels?.availableThoughtLevels ?? [];
  const currentThoughtLevelId = status?.thoughtLevels?.currentThoughtLevelId ?? null;

  const groupedModels = useMemo(() => {
    const groups = new Map<string, typeof availableModels>();
    for (const model of availableModels) {
      const slashIndex = model.name.indexOf("/");
      const group = slashIndex > 0 ? model.name.slice(0, slashIndex) : "";
      const items = groups.get(group) ?? [];
      items.push(model);
      groups.set(group, items);
    }
    return groups;
  }, [availableModels]);

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
    async (modelId: string | null) => {
      if (!modelId || modelId === currentModelId) return;
      try {
        await request.setModel({ sessionId: assistantId, modelId });
      } catch (error) {
        onStatusChange((current) => ({
          ...(current ?? {
            models: null,
            thoughtLevels: null,
            sourceAgentId: null,
            enabled: true,
            workspace: "",
          }),
          connectionStatus: "error",
          error: extractErrorMessage(error) || "Failed to update Assistant model.",
          isStreaming: false,
          dreaming: false,
        }));
      }
    },
    [assistantId, currentModelId, onStatusChange],
  );

  const changeThoughtLevel = useCallback(
    async (thoughtLevelId: string | null) => {
      if (!thoughtLevelId || thoughtLevelId === currentThoughtLevelId) return;
      try {
        await request.setThoughtLevel({ sessionId: assistantId, thoughtLevelId });
      } catch (error) {
        onStatusChange((current) => ({
          ...(current ?? {
            models: null,
            thoughtLevels: null,
            sourceAgentId: null,
            enabled: true,
            workspace: "",
          }),
          connectionStatus: "error",
          error: extractErrorMessage(error) || "Failed to update Assistant thinking level.",
          isStreaming: false,
          dreaming: false,
        }));
      }
    },
    [assistantId, currentThoughtLevelId, onStatusChange],
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
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 min-w-16 max-w-48 shrink gap-2 overflow-hidden text-xs text-muted-foreground hover:text-foreground"
                      />
                    }
                  >
                    <Astroid className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {currentModel?.name ?? t("assistant.selectModel", "Model")}
                    </span>
                    <ChevronDown className="size-3 shrink-0 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-auto! max-w-72 min-w-(--anchor-width)"
                  >
                    {groupedModels.size <= 1
                      ? availableModels.map((model) => (
                          <DropdownMenuItem
                            key={model.modelId}
                            onClick={() => void changeModel(model.modelId)}
                            className="gap-2"
                          >
                            <Check
                              className={`size-3 shrink-0 ${model.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                            />
                            <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                              <span className="truncate">{model.name}</span>
                              {model.description && (
                                <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                                  {model.description}
                                </span>
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))
                      : Array.from(groupedModels.entries()).map(([group, models]) =>
                          group ? (
                            <DropdownMenuSub key={group}>
                              <DropdownMenuSubTrigger>{group}</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="max-w-72">
                                {models.map((model) => (
                                  <DropdownMenuItem
                                    key={model.modelId}
                                    onClick={() => void changeModel(model.modelId)}
                                    className="gap-2"
                                  >
                                    <Check
                                      className={`size-3 shrink-0 ${model.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                                    />
                                    <span className="truncate">{model.name}</span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          ) : (
                            models.map((model) => (
                              <DropdownMenuItem
                                key={model.modelId}
                                onClick={() => void changeModel(model.modelId)}
                                className="gap-2"
                              >
                                <Check
                                  className={`size-3 shrink-0 ${model.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                                />
                                <span className="truncate">{model.name}</span>
                              </DropdownMenuItem>
                            ))
                          ),
                        )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {availableThoughtLevels.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 min-w-16 max-w-32 shrink gap-2 overflow-hidden text-xs text-muted-foreground hover:text-foreground"
                      />
                    }
                  >
                    <Gauge className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {availableThoughtLevels.find((level) => level.id === currentThoughtLevelId)
                        ?.name ?? t("assistant.selectThinking", "Thinking")}
                    </span>
                    <ChevronDown className="size-3 shrink-0 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto! min-w-(--anchor-width)">
                    {availableThoughtLevels.map((level) => (
                      <DropdownMenuItem
                        key={level.id}
                        onClick={() => void changeThoughtLevel(level.id)}
                        className="gap-2"
                      >
                        <Check
                          className={`size-3 shrink-0 ${level.id === currentThoughtLevelId ? "opacity-100" : "opacity-0"}`}
                        />
                        <span>{level.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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
