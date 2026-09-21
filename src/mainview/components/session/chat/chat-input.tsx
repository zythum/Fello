import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SuggestionDataItem } from "react-mentions";
import { resolveMentions, nodesToMentionText } from "../../../lib/mention-utils";
import { useFocusTarget, useFocusTargetRegistry } from "../../../lib/keyboard";
import {
  useSessionIsLoading,
  useSessionAskUserRequests,
  useSessionDraftInput,
  useSessionDraftAttachments,
} from "../../../lib/session-selectors";
import { useAppStore, type StagedAttachmentInfo, type SessionState } from "../../../store";
import type { ChatMessage } from "../../../lib/chat-message";
import { request } from "../../../backend";
import { reduceFlushStreaming } from "../../../lib/session-state-reducer";
import * as tiks from "@rexa-developer/tiks";
import { Button } from "@/components/ui/button";
import { ArrowUp, Square, ChevronDown, Check, Astroid, Gauge, Eclipse } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { extractErrorMessage } from "@/lib/utils";
import { generateUUID } from "@/lib/utils";
import { useMessage } from "../../providers/message";
import type { SessionInfo } from "../../../../shared/schema";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { VoiceInputButtonRef } from "../../common/voice-input-button";
import {
  ChatTextarea,
  IMAGE_MIME_TYPES,
  type ChatTextareaMention,
  type ChatTextareaSubmitValue,
} from "./chat-textarea";

/** `/` 命令建议面板（chat-input 独有，chat-textarea 只认 `#` / `@`） */
function renderSlashSuggestion(
  suggestion: SuggestionDataItem,
  commands: SessionInfo["availableCommands"],
) {
  const command = commands.find((c) => c.name === suggestion.id);
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-foreground">/{suggestion.id}</span>
      {command?.description && (
        <span className="ml-1 text-[10px] text-muted-foreground/50 truncate">
          {command.description}
        </span>
      )}
    </div>
  );
}

/** 将暂存的附件信息构建成 ContentBlock 列表 */
function buildAttachmentBlocks(attachments: StagedAttachmentInfo[]): ContentBlock[] {
  return attachments.map((att) => {
    if (att.type === "image") {
      return {
        type: "image",
        mimeType: att.mimeType,
        data: att.data,
      } satisfies ContentBlock;
    }
    return {
      type: "resource",
      resource: {
        uri: `file://${att.filename}`,
        text: att.data,
      },
    } satisfies ContentBlock;
  });
}

export function ChatInput({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const { addMessage, updateSession } = useAppStore();
  const isStreaming = session.isStreaming;
  const availableModels = useMemo(
    () => session.models?.availableModels ?? [],
    [session.models?.availableModels],
  );
  const currentModelId = session.models?.currentModelId ?? null;

  // Group models by prefix (e.g. "openai/gpt-4o" → group "openai")
  const groupedModels = useMemo(() => {
    const groups = new Map<string, typeof availableModels>();
    for (const m of availableModels) {
      const slashIdx = m.name.indexOf("/");
      const key = slashIdx > 0 ? m.name.slice(0, slashIdx) : "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return groups;
  }, [availableModels]);

  const handleModelChange = useCallback(
    async (modelId: string) => {
      const sid = session.id;
      if (!sid) return;
      useAppStore.getState().updateSession({
        ...session,
        models: { ...session.models!, currentModelId: modelId },
      });
      try {
        await request.setModel({ sessionId: sid, modelId });
      } catch (err) {
        console.error("Failed to set model:", err);
        useAppStore.getState().updateSession(session);
      }
    },
    [session],
  );

  const handleModeChange = useCallback(
    async (modeId: string) => {
      const sid = session.id;
      if (!sid) return;
      useAppStore.getState().updateSession({
        ...session,
        modes: { ...session.modes!, currentModeId: modeId },
      });
      try {
        await request.setMode({ sessionId: sid, modeId });
      } catch (err) {
        console.error("Failed to set mode:", err);
        useAppStore.getState().updateSession(session);
      }
    },
    [session],
  );

  const handleThoughtLevelChange = useCallback(
    async (thoughtLevelId: string) => {
      const sid = session.id;
      if (!sid) return;
      useAppStore.getState().updateSession({
        ...session,
        thoughtLevels: { ...session.thoughtLevels!, currentThoughtLevelId: thoughtLevelId },
      });
      try {
        await request.setThoughtLevel({ sessionId: sid, thoughtLevelId });
      } catch (err) {
        console.error("Failed to set thought level:", err);
        useAppStore.getState().updateSession(session);
      }
    },
    [session],
  );

  const availableModes = session.modes?.availableModes ?? [];
  const currentModeId = session.modes?.currentModeId ?? null;
  const availableThoughtLevels = session.thoughtLevels?.availableThoughtLevels ?? [];
  const currentThoughtLevelId = session.thoughtLevels?.currentThoughtLevelId ?? null;
  const initializeInfo = session.initializeInfo;
  const isLoading = useSessionIsLoading(session.id);
  const askUserRequests = useSessionAskUserRequests(session.id);
  const availableCommands = session.availableCommands;
  const draftInput = useSessionDraftInput(session.id);
  const draftAttachments = useSessionDraftAttachments(session.id);

  /** session state 更新器（自动绑定当前 session.id） */
  const updateSessionState = useCallback(
    (updater: (s: SessionState) => Partial<SessionState>) => {
      useAppStore.getState().updateSessionState(session.id, updater);
    },
    [session.id],
  );

  const promptCapabilities = initializeInfo?.agentCapabilities?.promptCapabilities;
  const supportsImage = promptCapabilities?.image ?? false;
  const supportsEmbedded = promptCapabilities?.embeddedContext ?? false;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceInputRef = useRef<VoiceInputButtonRef>(null);
  const { focus } = useFocusTargetRegistry();
  const getTextarea = useCallback(() => textareaRef.current, []);

  const focusInput = useCallback(() => {
    const textarea = getTextarea();
    if (!textarea || textarea.disabled) return false;

    textarea.focus({ preventScroll: true });
    return document.activeElement === textarea;
  }, [getTextarea]);
  useFocusTarget("chat-input", focusInput);

  // ---- 本地输入状态（轻量，不经过 store，保证打字流畅） ----
  // 放在 appendMentionsToInput 之前声明：引用了尚未初始化的 useState 会被 react(immutability) 判为不合法
  const [localInput, setLocalInput] = useState(draftInput);

  /** 将 mention 文本追加到输入末尾（与 fello-add-to-chat 行为一致），并聚焦输入框 */
  const appendMentionsToInput = useCallback(
    (mentions: string) => {
      setLocalInput((prev) => (prev ? `${prev} ${mentions} ` : `${mentions} `));
      requestAnimationFrame(() => getTextarea()?.focus());
    },
    [getTextarea],
  );

  const localInputRef = useRef(localInput);
  // eslint-disable-next-line react/refs
  localInputRef.current = localInput;

  const prevSessionIdRef = useRef(session.id);
  // 当前 session 切换时：存旧的，读新的
  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    if (prevId !== session.id) {
      // 保存旧 session 的暂存
      if (prevId) {
        useAppStore
          .getState()
          .updateSessionState(prevId, () => ({ draftInput: localInputRef.current }));
      }
      prevSessionIdRef.current = session.id;
    }
    // 加载新 session 的暂存
    // eslint-disable-next-line react/set-state-in-effect
    setLocalInput(draftInput);
    // 组件卸载时也保存当前输入（使用 ref 避免闭包捕获旧值）
    return () => {
      if (session.id) {
        useAppStore
          .getState()
          .updateSessionState(session.id, () => ({ draftInput: localInputRef.current }));
      }
    };
  }, [session.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 注意：draftInput 只在 session.id 变化时读取，不作为常规依赖

  // blur 时写回 store（确保跨 session 持久化）
  const handleBlur = useCallback(() => {
    updateSessionState(() => ({ draftInput: localInput }));
  }, [localInput, updateSessionState]);

  // Handle external add-to-chat events from file-panel
  useEffect(() => {
    const handleAddToChat = (e: Event) => {
      const customEvent = e as CustomEvent;
      const nodes = customEvent.detail as { id: string; name: string; isFolder: boolean }[];
      if (!nodes || nodes.length === 0) return;
      appendMentionsToInput(nodesToMentionText(nodes));
    };

    document.addEventListener("fello-add-to-chat", handleAddToChat);
    return () => document.removeEventListener("fello-add-to-chat", handleAddToChat);
  }, [appendMentionsToInput]);

  /** 附件变更（新增 / 删除）由输入区算出新列表后回传 */
  const handleAttachmentChange = useCallback(
    (next: StagedAttachmentInfo[]) => {
      updateSessionState(() => ({ draftAttachments: next }));
    },
    [updateSessionState],
  );

  // ---- 文件选择 / 拖拽 / 粘贴共用的处理（见 chat-textarea 的 insertInputFiles）----
  /**
   * 图片附件白名单（同时决定附件按钮是否渲染）：
   * - agent 能收图片 → 用默认白名单，命中者作为内嵌附件；
   * - 只支持内嵌上下文 → 空数组（按钮仍在，选中的文件一律走 mention 引用）；
   * - 都不支持 → 不渲染附件按钮。
   */
  const imageMimeTypes = supportsImage ? IMAGE_MIME_TYPES : supportsEmbedded ? [] : undefined;

  /** Fetch slash command suggestions — only when / is at position 0 */
  const fetchSlashCommands = useCallback(
    (search: string, callback: (data: { id: string; display: string }[]) => void) => {
      // Only show suggestions if input starts with "/"
      if (!localInput.startsWith("/")) {
        callback([]);
        return;
      }
      const lower = search.toLowerCase();
      const items = availableCommands
        .filter((cmd) => !lower || cmd.name.toLowerCase().includes(lower))
        .slice(0, 6)
        .map((cmd) => ({ id: cmd.name, display: `/${cmd.name}` }));
      callback(items);
    },
    [localInput, availableCommands],
  );

  /** `/` 是 chat-input 独有的 trigger，`#` / `@` 由 ChatTextarea 内置 */
  const extraMentions = useMemo<ChatTextareaMention[]>(
    () => [
      {
        trigger: "/",
        data: fetchSlashCommands,
        renderSuggestion: (suggestion) => renderSlashSuggestion(suggestion, availableCommands),
      },
    ],
    [fetchSlashCommands, availableCommands],
  );

  const handleSubmit = useCallback(
    async (value: ChatTextareaSubmitValue) => {
      await voiceInputRef.current?.stop();
      tiks.click();
      // 附件与文本都由输入区交回（语音面板的转写也走这条路径），不再依赖 store 里的草稿。
      const currentAttachments = value.attachments;
      const fromVoicePanel = value.source === "voice";

      const displayId = generateUUID();
      const resolved = resolveMentions(value.text).trim();
      if ((!resolved && currentAttachments.length === 0) || !session.id) return;
      if (isStreaming) {
        // 语音面板发送允许打断：先取消当前生成，再发送新的 prompt。
        // 普通输入框在 streaming 时主操作按钮已是「停止」，保持原有早退行为（不从这里打断）。
        if (!fromVoicePanel) return;
        await request.cancelPrompt({ sessionId: session.id });
      }

      // Build ContentBlocks from stored attachments directly
      const attachmentBlocks = buildAttachmentBlocks(currentAttachments);

      const contents: ContentBlock[] = [];
      if (resolved) {
        contents.push({
          type: "text",
          text: resolved,
          _meta: {
            display_id: displayId,
            optimistic_id: generateUUID(),
          },
        });
      }
      contents.push(
        ...attachmentBlocks.map((block) => {
          return Object.assign(
            {
              _meta: {
                display_id: displayId,
                optimistic_id: generateUUID(),
              },
            },
            block,
          );
        }),
      );

      const userMessage = {
        role: "user_message",
        contents,
        displayId: displayId,
        receivedAt: Date.now(),
      } satisfies ChatMessage;

      // 1. Optimistic Update: clear input + attachments, add message to screen instantly
      setLocalInput("");
      updateSessionState(() => ({
        draftInput: "",
        draftAttachments: [],
      }));
      addMessage(session.id, userMessage);
      updateSession({ ...session, isStreaming: true });
      document.dispatchEvent(new CustomEvent("fello-scroll-to-bottom"));
      if (fromVoicePanel) {
        // 语音面板发送完成 → 焦点交给聊天区（等价于 Cmd+Shift+M 的效果），
        // 方便用遥控器方向键直接浏览输出。
        focus("chat-area");
      }

      try {
        // 2. Wait for the generation to complete
        const promptResponse = await request.sendPrompt({
          sessionId: session.id,
          contents,
        });

        // 3. Show warning if not end_turn
        if (promptResponse.stopReason && promptResponse.stopReason !== "end_turn") {
          const stopReasonLabels: Record<string, string> = {
            max_tokens: t("chatInput.stopReasonMaxTokens", "Reached maximum token limit"),
            max_turn_requests: t(
              "chatInput.stopReasonMaxTurnRequests",
              "Reached maximum turn limit",
            ),
            refusal: t("chatInput.stopReasonRefusal", "Model refused to respond"),
            cancelled: t("chatInput.stopReasonCancelled", "Generation was cancelled"),
          };
          const label = stopReasonLabels[promptResponse.stopReason] || promptResponse.stopReason;
          if (promptResponse.stopReason === "cancelled") {
            toast.info(label);
          } else {
            toast.error(label);
          }
        }
      } catch (err) {
        // 4. Rollback on Network Failure
        const currentState = useAppStore.getState().getSessionState(session.id);
        const isStillOptimistic = currentState.messages.some((m) => m.displayId === displayId);

        if (isStillOptimistic) {
          console.error("Prompt error (network failure):", err);
          const newMessages = currentState.messages.filter((m) => m.displayId !== displayId);
          useAppStore.getState().updateSessionState(session.id, () => ({ messages: newMessages }));
        } else {
          console.error("Prompt error (generation failure):", err);
        }

        toast.error(
          `${t("message.errorTitle", "Error")}: ${extractErrorMessage(err) || t("chatInput.generationFailed", "Generation failed")}`,
        );

        // If an error occurs, the backend might have crashed or network failed before
        // broadcasting the isStreaming: false event. So we ensure it is cleaned up locally.
        useAppStore
          .getState()
          .updateSessionState(session.id, () => reduceFlushStreaming(currentState));

        updateSession({ ...session, isStreaming: false });
      }
    },
    [session, isStreaming, addMessage, updateSessionState, t, toast, updateSession, focus],
  );

  const hasActiveAskUser = askUserRequests ? askUserRequests.length > 0 : false;
  const disabled =
    !session.id || session.connectionStatus !== "connected" || isLoading || hasActiveAskUser;
  /**
   * 语音面板的可用性**不能**跟着 `disabled` 走：流式生成期间输入框禁用，但按住语音键
   * 必须照常可用（发送时由 `handleSubmit` 先 cancelPrompt 再发送）。
   * ask-user 弹窗期间仍排除本输入区，让面板落到弹窗自己的输入区上。
   */
  const voicePanelEnabled =
    Boolean(session.id) && session.connectionStatus === "connected" && !hasActiveAskUser;

  // ---- 工具栏的 chat-only 部分：交给 ChatTextarea 的 leftSlot / rightSlot / primaryAction ----
  const modeSelector = availableModes.length > 0 && (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-7 min-w-16 text-xs text-muted-foreground hover:text-foreground gap-2 max-w-48 shrink overflow-hidden"
          />
        }
      >
        <Eclipse className="size-3.5" />
        <span className="truncate">
          {availableModes.find((m) => m.id === currentModeId)?.name ?? t("chatInput.mode", "Mode")}
        </span>
        <ChevronDown className="size-3 opacity-60 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-auto! max-h-none! max-w-60 min-w-(--anchor-width)"
      >
        {availableModes.map((mode) => (
          <DropdownMenuItem
            key={mode.id}
            onClick={() => handleModeChange(mode.id)}
            className="gap-2"
          >
            <Check
              className={`size-3 shrink-0 ${mode.id === currentModeId ? "opacity-100" : "opacity-0"}`}
            />
            <div className="flex min-w-0 flex-col gap-0.5 pr-3">
              <span>{mode.name}</span>
              {mode.description && (
                <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                  {mode.description}
                </span>
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const modelSelector = availableModels.length > 0 && (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-7 min-w-16 text-xs text-muted-foreground hover:text-foreground gap-2 max-w-48 shrink overflow-hidden"
          />
        }
      >
        <Astroid className="size-3.5" />
        <span className="truncate">
          {availableModels.find((m) => m.modelId === currentModelId)?.name ??
            t("chatInput.selectModel", "Select model")}
        </span>
        <ChevronDown className="size-3 opacity-60 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto! max-w-72 min-w-(--anchor-width)">
        {groupedModels.size <= 1
          ? availableModels.map((m) => (
              <DropdownMenuItem
                key={m.modelId}
                onClick={() => handleModelChange(m.modelId)}
                className="gap-2"
              >
                <Check
                  className={`size-3 shrink-0 ${m.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                />
                <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                  <span className="truncate">{m.name}</span>
                  {m.description && (
                    <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                      {m.description}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
            ))
          : Array.from(groupedModels.entries()).map(([group, models]) =>
              group ? (
                <DropdownMenuSub key={group}>
                  <DropdownMenuSubTrigger className="gap-2">
                    <Check
                      className={`size-3 shrink-0 ${models.some((m) => m.modelId === currentModelId) ? "opacity-100" : "opacity-0"}`}
                    />
                    {group}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 overflow-y-auto min-w-40">
                    {models.map((m) => (
                      <DropdownMenuItem
                        key={m.modelId}
                        onClick={() => handleModelChange(m.modelId)}
                        className="gap-2"
                      >
                        <Check
                          className={`size-3 shrink-0 ${m.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                        />
                        <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                          <span className="truncate">{m.name.slice(group.length + 1)}</span>
                          {m.description && (
                            <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                              {m.description}
                            </span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                models.map((m) => (
                  <DropdownMenuItem
                    key={m.modelId}
                    onClick={() => handleModelChange(m.modelId)}
                    className="gap-2"
                  >
                    <Check
                      className={`size-3 shrink-0 ${m.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                    />
                    <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                      <span className="truncate">{m.name}</span>
                      {m.description && (
                        <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                          {m.description}
                        </span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))
              ),
            )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const thoughtLevelSelector = availableThoughtLevels.length > 0 && (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground gap-2 max-w-48 shrink overflow-hidden"
          />
        }
      >
        <Gauge className="size-3.5" />
        <span className="truncate">
          {availableThoughtLevels.find((l) => l.id === currentThoughtLevelId)?.name ?? "Thought"}
        </span>
        <ChevronDown className="size-3 opacity-60 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-auto! max-h-none! max-w-60 min-w-(--anchor-width)"
      >
        {availableThoughtLevels.map((level) => (
          <DropdownMenuItem
            key={level.id}
            onClick={() => handleThoughtLevelChange(level.id)}
            className="gap-2"
          >
            <Check
              className={`size-3 shrink-0 ${level.id === currentThoughtLevelId ? "opacity-100" : "opacity-0"}`}
            />
            <div className="flex min-w-0 flex-col gap-0.5 pr-3">
              <span>{level.name}</span>
              {level.description && (
                <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                  {level.description}
                </span>
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const primaryAction = isStreaming ? (
    <Button
      variant="destructive"
      size="icon"
      className="size-7 cursor-default rounded-lg"
      onClick={() => request.cancelPrompt({ sessionId: session.id })}
      aria-label={t("chatInput.stop", "Stop")}
    >
      <Square className="size-3.5" />
    </Button>
  ) : (
    <span className="cursor-default">
      <Button
        size="icon"
        className="size-7 rounded-lg"
        onClick={() =>
          void handleSubmit({
            text: localInput,
            attachments: draftAttachments,
            source: "input",
          })
        }
        disabled={disabled || (!localInput.trim() && draftAttachments.length === 0)}
        aria-label={t("chatInput.send", "Send")}
      >
        <ArrowUp className="size-3.5" />
      </Button>
    </span>
  );

  return (
    <div
      className={`p-6 -mt-6 relative transition-opacity duration-300 ${hasActiveAskUser ? "opacity-30 pointer-events-none" : ""}`}
    >
      <div className="mx-auto max-w-5xl">
        <ChatTextarea
          sessionId={session.id}
          className="shadow-[0_0_20px] shadow-primary/10 dark:shadow-primary/20"
          textValue={localInput}
          onTextValueChange={setLocalInput}
          inputRef={textareaRef}
          voiceInputRef={voiceInputRef}
          onBlur={handleBlur}
          // 输入区把「当前值 + 附件 + 来源」交回来，语音面板也走同一条路径
          onSubmit={(value) => void handleSubmit(value)}
          placeholder={
            disabled ? t("chatInput.placeholderDisabled") : t("chatInput.placeholderActive")
          }
          disabled={disabled}
          voicePanelEnabled={voicePanelEnabled}
          attachmentAccepts={imageMimeTypes}
          attachments={draftAttachments}
          onAttachmentChange={handleAttachmentChange}
          extraMentions={extraMentions}
          leftSlot={modeSelector}
          rightSlot={
            <>
              {modelSelector}
              {thoughtLevelSelector}
            </>
          }
          primaryAction={primaryAction}
        />
      </div>
    </div>
  );
}
