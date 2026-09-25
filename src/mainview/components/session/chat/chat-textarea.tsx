import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Mention,
  MentionsInput,
  type MentionProps,
  type MentionsInputProps,
  type MentionsInputStyle,
  type MentionsSuggestionsStyle,
  type SuggestionDataItem,
} from "react-mentions";
import {
  ArrowUp,
  AtSign,
  Keyboard,
  Clipboard,
  FileText,
  Folder,
  Hash,
  ImageIcon,
  Library,
  LoaderCircle,
  Paperclip,
  Wrench,
  X,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn, generateUUID } from "@/lib/utils";
import { useAppStore, type StagedAttachmentInfo } from "../../../store";
import { isWebUI } from "../../../backend";
import { electron } from "../../../electron";
import { useSessionById } from "../../../lib/session-selectors";
import {
  useAtSuggestions,
  useFileSuggestions,
  type MentionFetcher,
} from "../../../lib/mention-suggestions";
import {
  MENTION_MARKUP,
  insertPathsAsMentions,
  nodesToMentionText,
  type MentionPathInput,
} from "../../../lib/mention-utils";
import { insertMentionTrigger, insertNewlineAtCaret } from "../../../lib/textarea";
import type { SkillInfo } from "../../../../shared/schema";
import { VoiceInputButton, type VoiceInputButtonRef } from "../../common/voice-input-button";
import { useVoicePanelTarget } from "../../../lib/peripherals/voice-panel-provider";

/**
 * chat-input 与 chat-ask-user-dialog 输入区的公共实现（`ChatTextarea` 一个组件 = 盒子 + 输入框 + 工具栏）。
 *
 * 两个输入区共用的部分在这里默认渲染 / 实现：盒子（边框 / focus ring / 拖拽高亮 / 拖放 / 粘贴）、
 * MentionsInput（`#` / `@` 建议源与面板、尺寸预设）、Enter 提交策略、附件预览、
 * 文件选择 / 拖拽 / 粘贴的文件处理、工具栏的附件 / `#` / `@` / 片段按钮与语音按钮。
 * 建议源与 snippets 由本组件自行读取（按 `sessionId` / store）。
 *
 * 差异部分仍由调用方传入：认可哪些图片附件（`attachmentAccepts`）、附件列表与变更回调、
 * 盒子的额外样式（`className`）、`/` 命令补全、draft 持久化、
 * Mode / Model / Thought 选择器与主操作按钮（走 `leftSlot` / `rightSlot` / `primaryAction`）、
 * ask-user 的选项区与卡片动画。
 */

/** 建议项渲染器：只用到 react-mentions 的 id / display 两个字段 */
export type MentionSuggestionRenderer = (suggestion: SuggestionDataItem) => ReactNode;

/** react-mentions 的 keydown 事件（textarea | input 联合类型） */
type ChatTextareaKeyDownEvent = Parameters<NonNullable<MentionsInputProps["onKeyDown"]>>[0];

/** fello 文件树拖拽的私有 MIME 类型 */
const TREE_NODES_TYPE = "application/x-fello-tree-nodes";

/** 树节点（file-panel 拖拽）的数据形态 */
interface TreeDropNode {
  id: string;
  name: string;
  isFolder: boolean;
}

/**
 * 默认认可为「图片附件」的 MIME 类型。
 * ACP 的 `promptCapabilities.image` 只声明布尔能力，具体类型由客户端决定；
 * 需要收窄 / 放宽时由调用方传自己的数组。
 */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"];

/** 读取 File 为 base64（不含 data: URL 前缀） */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 文件（选择 / 拖拽 / 粘贴）的统一入口：
 * - 命中 `attachmentAccepts` 且支持附件（`attachments !== null`）的图片 → 读成 base64 后作为附件，
 *   经 `onAttachmentChange` 追加（读不出来则退化为路径 mention）；
 * - 其余文件 → 绝对路径 mention 插入光标处（WebUI 下 getPathForFile 返回空串，自动降级）。
 * @returns 是否有文件被处理（调用方据此决定是否继续尝试其它 dataTransfer 类型）
 */
async function insertInputFiles(
  files: File[],
  options: {
    textarea: HTMLTextAreaElement | null;
    projectId: string | undefined;
    projectCwd?: string;
    attachmentAccepts?: readonly string[];
    attachments: StagedAttachmentInfo[] | null;
    onAttachmentChange?: (attachments: StagedAttachmentInfo[]) => void;
  },
): Promise<boolean> {
  const { textarea, projectId, projectCwd, attachmentAccepts, attachments, onAttachmentChange } =
    options;
  const paths: MentionPathInput[] = [];
  const added: StagedAttachmentInfo[] = [];
  // 没有 attachments（null）或没有变更回调时都不能暂存附件，否则文件会既不成附件也不成 mention
  const canStageAttachments = attachments !== null && Boolean(onAttachmentChange);

  for (const file of files) {
    const asAttachment =
      canStageAttachments && Boolean(file.type) && Boolean(attachmentAccepts?.includes(file.type));
    if (asAttachment) {
      try {
        added.push({
          id: generateUUID(),
          filename: file.name,
          mimeType: file.type,
          type: "image",
          data: await readFileAsBase64(file),
        });
        continue;
      } catch {
        // 读不出内容（如文件夹）：退化为路径 mention
      }
    }
    const absPath = electron.getPathForFile(file);
    if (absPath) paths.push({ path: absPath, isImage: file.type.startsWith("image/") });
  }

  if (added.length > 0 && attachments !== null && onAttachmentChange) {
    onAttachmentChange([...attachments, ...added]);
  }
  if (paths.length > 0 && textarea && projectId) {
    await insertPathsAsMentions(textarea, paths, { projectId, projectCwd });
  }

  return added.length > 0 || paths.length > 0;
}

/**
 * 输入区的拖拽（文件 / 外部 file:// URI / file-panel 树节点）。
 * 只给 ChatTextarea 内部使用：拖拽高亮画在它自己的盒子上，因此外部无需感知。
 */
function useChatDropTarget({
  sessionId,
  textareaRef,
  attachmentAccepts,
  attachments,
  onAttachmentChange,
  onDropTreeNodes,
}: {
  sessionId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 图片附件白名单（透传给 insertInputFiles） */
  attachmentAccepts?: readonly string[];
  attachments: StagedAttachmentInfo[] | null;
  onAttachmentChange?: (attachments: StagedAttachmentInfo[]) => void;
  /** 树节点拖拽（file-panel → 追加 mention 文本） */
  onDropTreeNodes: (nodes: TreeDropNode[]) => void;
}) {
  const session = useSessionById(sessionId);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
    },
    [],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    const types = event.dataTransfer.types;
    const acceptable =
      types.includes("Files") || types.includes("text/uri-list") || types.includes(TREE_NODES_TYPE);
    if (!acceptable) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    // child→child 切换会先 leave 再 enter，防抖避免高亮闪烁
    if (dragLeaveTimer.current) {
      clearTimeout(dragLeaveTimer.current);
      dragLeaveTimer.current = null;
    }
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    dragLeaveTimer.current = setTimeout(() => setIsDragOver(false), 50);
  }, []);

  const onDrop = useCallback(
    async (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length > 0) {
        const handled = await insertInputFiles(files, {
          textarea: textareaRef.current,
          projectId: session?.projectId,
          projectCwd: session?.cwd,
          attachmentAccepts,
          attachments,
          onAttachmentChange,
        });
        if (handled) return;
        // 文件没能处理（如 WebUI / 文件夹）→ 继续尝试下面的 text/uri-list
      }

      // 外部来源的 file:// URI（VS Code 文件树拖拽等）
      const uriList = event.dataTransfer.getData("text/uri-list");
      const uriPaths = (uriList ? uriList.split("\n") : [])
        .map((uri) => uri.trim())
        .filter((uri) => uri.startsWith("file://"))
        .map((uri) => decodeURIComponent(uri.replace(/^file:\/\//, "")))
        .filter(Boolean);
      if (uriPaths.length > 0) {
        const target = textareaRef.current;
        if (target && session?.projectId) {
          await insertPathsAsMentions(target, uriPaths, {
            projectId: session.projectId,
            projectCwd: session.cwd,
          });
        }
        return;
      }

      // 树节点拖拽（file-panel）
      const raw = event.dataTransfer.getData(TREE_NODES_TYPE);
      if (!raw) return;
      try {
        const nodes = JSON.parse(raw) as TreeDropNode[];
        if (nodes.length > 0) onDropTreeNodes(nodes);
      } catch {
        // ignore malformed data
      }
    },
    [attachmentAccepts, attachments, onAttachmentChange, session, textareaRef, onDropTreeNodes],
  );

  return { isDragOver, onDrop, onDragOver, onDragLeave };
}

/** 只暴露 Enter 策略需要的字段，避免把元素类型绑死（keydown 事件是 textarea | input 联合类型） */
interface EnterKeyLikeEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  nativeEvent: { isComposing: boolean };
  preventDefault: () => void;
}

/**
 * Enter 键策略（chat-input 与 chat-ask-user-dialog 行为一致，因此内置于输入框外壳）：
 * - 裸 Enter → 交给 onSubmit（阻止插入换行）
 * - Shift+Enter → 交给浏览器原生插入换行
 * - Ctrl/Cmd+Enter → 浏览器不插入任何字符（原因见 lib/textarea.ts 文件头），手动插入换行
 * - 输入法组合中（拼音 / 假名候选未上屏）不处理，此时 Enter 是候选上屏
 */
function handleEnterKeySubmit(
  event: EnterKeyLikeEvent,
  onSubmit: () => void,
  textarea: HTMLTextAreaElement | null | undefined,
): void {
  if (event.nativeEvent.isComposing) return;
  if (event.key !== "Enter") return;

  // 仅裸 Enter 提交
  if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    onSubmit();
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    insertNewlineAtCaret(textarea);
  }
}

/**
 * 内嵌附件预览。附件是调用方的受控数据（chat-input 存 session `draftAttachments`），
 * 外壳只负责渲染与删除回调；图片可悬浮预览。
 */
function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: StagedAttachmentInfo[];
  onRemove?: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 p-3 pb-0">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="relative flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs"
        >
          {att.type === "image" ? (
            <HoverCard>
              <HoverCardTrigger
                render={
                  <div className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                    <ImageIcon className="size-3.5" />
                    <span className="max-w-25 truncate">{att.filename}</span>
                  </div>
                }
              />
              <HoverCardContent className="w-auto p-1" side="top">
                <img
                  src={`data:${att.mimeType};base64,${att.data}`}
                  alt={att.filename}
                  className="max-h-50 max-w-50 rounded object-contain"
                />
              </HoverCardContent>
            </HoverCard>
          ) : (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FileText className="size-3.5" />
              <span className="max-w-25 truncate">{att.filename}</span>
            </div>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(att.id)}
              className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** 额外的 trigger（如 chat-input 的 `/` 命令），`#` / `@` 由 ChatTextarea 直接声明 */
export interface ChatTextareaMention {
  trigger: string;
  data: MentionFetcher;
  renderSuggestion?: MentionSuggestionRenderer;
}

/** `#` 建议面板：文件夹 / 图片 / 文件图标 + 名称 + 去掉 `#` 前缀的类型提示 */
function renderFileSuggestion(suggestion: SuggestionDataItem): ReactNode {
  const name = String(suggestion.id).split("/").pop();
  const display = suggestion.display ?? "";
  const isFolder = display.startsWith("#folder:");
  const isImage = display.startsWith("#image:");

  return (
    <div className="flex items-center gap-1">
      {isFolder ? (
        <Folder className="size-3.5 text-muted-foreground" />
      ) : isImage ? (
        <ImageIcon className="size-3.5 text-muted-foreground" />
      ) : (
        <FileText className="size-3.5 text-muted-foreground" />
      )}
      <span className="text-xs whitespace-nowrap text-foreground">{name}</span>
      <span className="ml-1 text-[10px] text-muted-foreground/50 flex-1 truncate">
        {display.slice(1)}
      </span>
    </div>
  );
}

/** `@` 建议面板：MCP 服务器（命令 / URL）与技能（名称 / 描述） */
function renderResourceSuggestion(
  suggestion: SuggestionDataItem,
  getSkills?: () => SkillInfo[],
): ReactNode {
  const display = suggestion.display ?? "";

  if (display.startsWith("@mcp:")) {
    const mcp = useAppStore.getState().configuredMcpServers.find((m) => m.id === suggestion.id);
    return (
      <div className="flex items-center gap-1">
        <Wrench className="size-3.5 text-muted-foreground" />
        <span className="text-xs whitespace-nowrap text-foreground">
          {mcp?.id ?? suggestion.id}
        </span>
        <span className="ml-1 text-[10px] text-muted-foreground/50 flex-1 truncate">
          {mcp?.type === "stdio"
            ? `${mcp.command} ${(mcp.args ?? []).join(" ")}`
            : mcp?.type === "http"
              ? mcp.url
              : ""}
        </span>
      </div>
    );
  }

  const skill = getSkills?.().find((s) => s.id === suggestion.id);
  return (
    <div className="flex items-center gap-1">
      <Library className="size-3.5 text-muted-foreground" />
      <span className="text-xs whitespace-nowrap text-foreground">
        {skill?.name ?? skill?.id ?? suggestion.id}
      </span>
      <span className="ml-1 text-[10px] text-muted-foreground/50 flex-1 truncate">
        {skill?.description}
      </span>
    </div>
  );
}

const displayTransform = (_id: string, display: string) => display;

export interface ChatTextareaProps {
  /** 建议源（`#` 文件 / `@` 应用）所归属的 session */
  sessionId: string;
  /** 输入框文本（受控） */
  textValue: string;
  onTextValueChange: (value: string) => void;
  /** 内层 textarea 的 ref（调用方也要用它：focus target、语音按钮、工具栏插入） */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onFocus?: () => void;
  onBlur?: () => void;
  /**
   * 提交回调：把**当前输入值**与**暂存附件**一并交回调用方，调用方不再需要自己从
   * state 里读（也因此语音面板可以复用同一条提交路径）。
   *
   * `source` 用于区分来源：`input` = 输入框（裸 Enter 或右下角按钮），
   * `voice` = 外设语音面板。调用方可据此决定额外行为（如语音发送时允许打断当前生成）。
   * Enter 相关策略内置：Shift+Enter 原生换行、Ctrl/Cmd+Enter 手动换行、
   * 输入法组合中不处理（详见 handleEnterKeySubmit）。
   */
  onSubmit: (value: ChatTextareaSubmitValue) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * 外设语音面板是否可用（缺省跟随 `disabled`）。
   *
   * 必须与输入框的可用性分开表达：流式生成期间输入框是禁用的，但语音面板要照常可用
   * （按住说话 → 复核 → 发送，发送时由调用方先打断当前生成）。
   */
  voicePanelEnabled?: boolean;
  /**
   * 尺寸 / 布局预设（输入区与工具栏成对）：
   * - `chat`：chat-input（13px / 最小 76px 高 / 左右 16px 内边距，工具栏在输入区下方流式排布）
   * - `compact`：ask-user（12px / 最小 108px 高 / 底部预留 38px，工具栏绝对定位悬浮在输入区上）
   */
  variant?: "chat" | "compact";
  /**
   * 认可为「图片附件」的 MIME 白名单，同时决定附件按钮是否渲染：
   * - 不传 → 不渲染附件按钮
   * - 非空 → 渲染按钮；命中列表的图片作为附件（需 `attachments !== null`），其余文件走 mention
   * - `[]` → 渲染按钮但什么都不是附件（agent 只支持内嵌上下文时，按钮用于选文件插入引用）
   */
  attachmentAccepts?: readonly string[];
  /** 输入区盒子（边框 / focus ring / 拖拽高亮）的额外类名，如卡片阴影 */
  className?: string;
  /** 语音输入按钮 */
  voiceInputRef: RefObject<VoiceInputButtonRef | null>;
  /** 工具簇之前的内容（如 chat-input 的 Mode 下拉） */
  leftSlot?: ReactNode;
  /** 语音按钮之前的内容（如 chat-input 的 Model / Thought 下拉） */
  rightSlot?: ReactNode;
  /** 主操作按钮（发送 / 停止 / 提交） */
  primaryAction: ReactNode;
  /**
   * 内嵌附件（受控）：
   * - `StagedAttachmentInfo[]`：支持附件，外壳渲染预览与删除（`[]` = 支持但当前为空）
   * - `null`：**明确不支持**（如 ask-user 输入框没有附件概念），此时不要传 onAttachmentChange
   *
   * 必填是为了让调用点显式表态，避免"忘了传"与"不支持"混在一起。
   * 另注意这与「图片算附件还是算 `#image:` mention」是两个正交的策略，后者由 `attachmentAccepts` 白名单表达。
   */
  attachments: StagedAttachmentInfo[] | null;
  onAttachmentChange?: (attachments: StagedAttachmentInfo[]) => void;
  /** 其它 trigger（如 `/` 命令） */
  extraMentions?: ChatTextareaMention[];
}

/** 提交载荷：输入区的当前值与暂存附件，附上来源标记。 */
export interface ChatTextareaSubmitValue {
  /** 待提交文本：来自输入框，或语音面板的转写。 */
  text: string;
  /** 暂存附件（不支持附件时为空数组）。 */
  attachments: StagedAttachmentInfo[];
  source: "input" | "voice";
}

/** 语音面板的呈现数据（由 `lib/peripherals/voice-panel-provider.tsx` 产出，本组件只负责画）。 */
export interface ChatTextareaVoicePanel {
  /** `recording` 为按住期间（未收到音频时显示加载态），`review` 为松手后的复核态。 */
  phase: "recording" | "review";
  /** 已经累积的转写文本（多次按住会累加）。 */
  transcript: string;
  /** 识别 / 通道错误，展示在正文之后，不遮挡已累积的文本。 */
  error: string | null;
  /** 0–1 的实时电平，供波形使用。 */
  audioLevel: number;
  /** 是否真的在收音频：为 false 时波形位置显示加载态。 */
  audioActive: boolean;
  /**
   * 收起面板并结束这一「段」（停 ASR、清空转写、回到 idle）。
   *
   * 提交与取消都调它：**是否真的提交由 ChatTextarea 决定**（它才知道输入值与附件，
   * 也才拿得到调用方的 `onSubmit`），语音模块不参与提交。
   */
  close: () => void;
}

export function ChatTextarea({
  sessionId,
  textValue,
  onTextValueChange,
  inputRef,
  onFocus,
  onBlur,
  onSubmit,
  placeholder,
  disabled,
  voicePanelEnabled,
  variant = "chat",
  attachments,
  onAttachmentChange,
  className,
  attachmentAccepts,
  voiceInputRef,
  leftSlot,
  rightSlot,
  primaryAction,
  extraMentions,
}: ChatTextareaProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const snippets = useAppStore((s) => s.snippets);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compact = variant === "compact";
  const session = useSessionById(sessionId);
  const fileSuggestions = useFileSuggestions(session?.projectId);
  const { fetcher: atSuggestions, getSkills } = useAtSuggestions({
    projectId: session?.projectId,
    mcpServerIds: session?.mcpServers ?? [],
  });
  // 不 memo：需要拿到最新的 textValue 才能追加
  /** 树节点拖拽（file-panel）：追加 mention 文本到输入末尾（与 fello-add-to-chat 行为一致） */
  const handleDropTreeNodes = (nodes: TreeDropNode[]) => {
    const mentions = nodesToMentionText(nodes);
    onTextValueChange(textValue ? `${textValue} ${mentions} ` : `${mentions} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const { isDragOver, onDrop, onDragOver, onDragLeave } = useChatDropTarget({
    sessionId,
    textareaRef: inputRef,
    attachmentAccepts,
    attachments,
    onAttachmentChange,
    onDropTreeNodes: handleDropTreeNodes,
  });

  /**
   * 语音面板：注册**本输入区**为宿主。可用性缺省跟随 `disabled`，调用方可用
   * `voicePanelEnabled` 单独表态（流式生成期间输入框禁用，但语音面板仍须可用）。
   * 注册与渲染都在这里，所以 chat-input / ask-user 不需要认识外设模块。
   */
  const voicePanel = useVoicePanelTarget({ enabled: voicePanelEnabled ?? !disabled });
  const panelWasActiveRef = useRef(false);
  const panelSubmittedRef = useRef(false);
  /** 「转成文字」路径：焦点回到输入框时把光标放到末尾，方便接着改。 */
  const panelToInputRef = useRef(false);

  /**
   * 面板收起后把焦点交还输入框（面板期间输入框是 display:none，浏览器会把焦点丢到 body）。
   * **提交**时不动焦点：交回调用方安排（例如 chat-input 交给聊天区）。
   */
  useEffect(() => {
    if (voicePanel) {
      panelWasActiveRef.current = true;
      return;
    }
    if (!panelWasActiveRef.current) return;
    panelWasActiveRef.current = false;
    const submitted = panelSubmittedRef.current;
    const toInput = panelToInputRef.current;
    panelSubmittedRef.current = false;
    panelToInputRef.current = false;
    if (submitted) return;
    const frame = requestAnimationFrame(() => {
      const textarea = inputRef.current;
      if (!textarea) return;
      textarea.focus();
      if (toInput) {
        // 文本刚被替换进来，把光标落到末尾（focus 不保证光标位置）
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [voicePanel, inputRef]);

  const handleVoicePanelSend = () => {
    if (!voicePanel) return;
    const value: ChatTextareaSubmitValue = {
      text: voicePanel.transcript,
      attachments: attachments ?? [],
      source: "voice",
    };
    panelSubmittedRef.current = true;
    voicePanel.close();
    onSubmit(value);
  };

  /**
   * 「转成文字」：把面板里的转写**替换**进输入框，走正常的受控变更路径
   * （`onTextValueChange`），因此草稿、mention 状态、上层 store 都照常同步 ——
   * 面板文本本身不进任何持久化状态。
   */
  const handleVoicePanelToInput = () => {
    if (!voicePanel) return;
    const text = voicePanel.transcript;
    panelToInputRef.current = true;
    voicePanel.close();
    onTextValueChange(text);
  };

  const boxRef = useRef<HTMLDivElement>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const contextMenuOpenRef = useRef(false);

  // 右键菜单在输入区内打开时保持高亮（此时 focus-within 不生效）。
  // 仅通过 mousedown 判断关闭：点在输入区内或菜单 popup 上保持，点别处 / Esc 关闭。
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const box = boxRef.current;
      if (!box || !box.contains(event.target as Node)) return;
      contextMenuOpenRef.current = true;
      setIsContextMenuOpen(true);
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (!contextMenuOpenRef.current) return;
      const box = boxRef.current;
      if (!box) return;
      // 点击在输入区内 → 不关闭
      if (box.contains(event.target as Node)) return;
      // 点击在上下文菜单 popup 上 → 不关闭（允许菜单交互）
      const target = event.target as HTMLElement;
      if (
        target?.closest?.('[data-slot="context-menu-content"]') ||
        target?.closest?.('[data-slot="context-menu"]')
      ) {
        return;
      }
      contextMenuOpenRef.current = false;
      setIsContextMenuOpen(false);
    };
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !contextMenuOpenRef.current) return;
      contextMenuOpenRef.current = false;
      setIsContextMenuOpen(false);
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, []);

  // 不 memo：onSubmit 每次渲染重建（如 ask-user 的提交依赖当前输入值），这里必须拿到最新闭包
  const handleKeyDown = (event: ChatTextareaKeyDownEvent) =>
    handleEnterKeySubmit(
      event,
      () => onSubmit({ text: textValue, attachments: attachments ?? [], source: "input" }),
      inputRef.current,
    );

  /** 粘贴文件：与文件选择 / 拖拽共用 insertInputFiles；纯文本放行浏览器默认粘贴 */
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files ?? []);
    // 无文件（纯文本）或 WebUI 下不接管
    if (files.length === 0 || isWebUI) return;
    // 只有粘贴到输入框本体时才处理
    if (event.target !== inputRef.current) return;

    event.preventDefault();
    void insertInputFiles(files, {
      textarea: inputRef.current,
      projectId: session?.projectId,
      projectCwd: session?.cwd,
      attachmentAccepts,
      attachments,
      onAttachmentChange,
    });
  };

  /** 附件按钮的文件选择入口，处理逻辑与拖拽 / 粘贴共用 insertInputFiles */
  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // files 已同步取出，这里立刻清空让同一个文件能被再次选择
    event.currentTarget.value = "";
    if (files.length === 0) return;

    await insertInputFiles(files, {
      textarea: inputRef.current,
      projectId: session?.projectId,
      projectCwd: session?.cwd,
      attachmentAccepts,
      attachments,
      onAttachmentChange,
    });
  };

  // extraMentions 是动态的，Mention 子项用数组拼（键已给，顺序不影响 trigger 匹配）
  const mentions: ReactElement<MentionProps>[] = [
    <Mention
      key="#"
      trigger="#"
      data={fileSuggestions}
      markup={MENTION_MARKUP}
      displayTransform={displayTransform}
      style={mentionStyle}
      appendSpaceOnAdd
      renderSuggestion={renderFileSuggestion}
    />,
    <Mention
      key="@"
      trigger="@"
      data={atSuggestions}
      markup={MENTION_MARKUP}
      displayTransform={displayTransform}
      style={mentionStyle}
      appendSpaceOnAdd
      renderSuggestion={(suggestion) => renderResourceSuggestion(suggestion, getSkills)}
    />,
  ];
  for (const mention of extraMentions ?? []) {
    mentions.push(
      <Mention
        key={mention.trigger}
        trigger={mention.trigger}
        data={mention.data}
        markup={MENTION_MARKUP}
        displayTransform={displayTransform}
        style={mentionStyle}
        appendSpaceOnAdd
        renderSuggestion={mention.renderSuggestion}
      />,
    );
  }

  return (
    <div
      ref={boxRef}
      className={cn(
        "relative rounded-lg border bg-card transition-colors focus-within:border-ring focus-within:ring-ring",
        isDragOver
          ? "border-primary ring-0.5 ring-primary bg-primary/5"
          : isContextMenuOpen
            ? "border-ring ring-ring"
            : "border-input",
        className,
      )}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onPasteCapture={handlePaste}
      onContextMenu={() => {
        // 右键点击 highlighter（MentionsInput 覆盖层）时保持输入框焦点，focus-within 样式才能生效
        const textarea = inputRef.current;
        if (textarea && document.activeElement !== textarea) textarea.focus();
      }}
    >
      {/*
        外设语音面板：**占真实 DOM 高度**的兄弟块，而不是浮层。
        面板出现时下方输入区整体让位（display:none，不占高度也不参与交互），
        盒子因此随面板长高，ask-user 的 compact 卡片布局不会被撑乱。
        高度上限按变体给：compact（弹窗内）用固定上限，chat 用视口比例。
      */}
      {voicePanel ? (
        <div className={cn("min-w-0", compact ? "max-h-56" : "max-h-[40vh]")}>
          <ChatTextareaVoicePanelView
            variant={variant}
            panel={voicePanel}
            onCancel={voicePanel.close}
            onSubmit={handleVoicePanelSend}
            onToInput={handleVoicePanelToInput}
          />
        </div>
      ) : null}
      <div className={cn(voicePanel && "hidden")}>
        {attachments !== null && attachments.length > 0 && (
          <AttachmentTray
            attachments={attachments}
            onRemove={
              onAttachmentChange
                ? (id) => onAttachmentChange(attachments.filter((att) => att.id !== id))
                : undefined
            }
          />
        )}
        <MentionsInput
          value={textValue}
          inputRef={inputRef}
          onChange={(_event, newValue) => onTextValueChange(newValue)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={t("chatInput.messageInput", "Message input")}
          style={variant === "compact" ? compactMentionsInputStyle : chatMentionsInputStyle}
          className="chat-mentions-input"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          a11ySuggestionsListLabel={t("chatInput.suggestions", "Suggestions")}
        >
          {mentions}
        </MentionsInput>
        <div
          className={cn(
            "flex cursor-text items-center justify-between",
            compact ? "absolute bottom-1.5 left-1.5 right-1.5" : "gap-2 -mt-3 overflow-hidden",
          )}
          onClick={(event) => {
            // 点击行空白处聚焦输入框；按钮与下拉交给各自的交互
            if ((event.target as HTMLElement).closest("button, select, [role='combobox']")) return;
            inputRef.current?.focus();
          }}
        >
          <div
            className={cn(
              "flex items-center",
              compact ? "gap-0.5" : "gap-2 p-2 overflow-hidden -mr-4",
            )}
          >
            {leftSlot}
            <div className={cn("flex items-center", compact && "gap-0.5")}>
              {attachmentAccepts && (
                <>
                  <input
                    type="file"
                    multiple
                    // 仍可任选文件：命中图片白名单的作为附件，其余一律走 mention 引用
                    accept="*/*"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-lg text-muted-foreground"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled}
                    aria-label={t("chatInput.attach", "Attach file")}
                  >
                    <Paperclip className="size-3.5" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg text-muted-foreground"
                disabled={disabled}
                aria-label={t("chatInput.reference", "Reference")}
                onClick={() => insertMentionTrigger(inputRef.current, "#")}
              >
                <Hash className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg text-muted-foreground"
                disabled={disabled}
                aria-label={t("chatInput.mention", "Mention")}
                onClick={() => insertMentionTrigger(inputRef.current, "@")}
              >
                <AtSign className="size-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 rounded-lg text-muted-foreground"
                      disabled={disabled}
                      aria-label={t("chatInput.snippets", "Snippets")}
                    >
                      <Clipboard className="size-3.5" />
                    </Button>
                  }
                />
                <DropdownMenuContent side="top" align="start" className="w-60">
                  {snippets.length > 0 ? (
                    snippets.map((s) => (
                      <DropdownMenuItem
                        key={s.id}
                        onClick={() => {
                          inputRef.current?.focus();
                          document.execCommand("insertText", false, s.content);
                        }}
                      >
                        <div className="flex min-w-0 flex-col gap-1 whitespace-normal">
                          <span className="text-xs">{s.title}</span>
                          <span className="wrap-break-word text-[10px] text-muted-foreground/60 line-clamp-2">
                            {s.content}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem onClick={() => navigate("/settings/snippets")}>
                      <span className="text-xs text-muted-foreground">
                        {t("chatInput.snippetsEmpty", "No snippets. Click to add in Settings.")}
                      </span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className={cn("flex items-center gap-2", !compact && "p-2 overflow-hidden")}>
            {rightSlot}
            <VoiceInputButton ref={voiceInputRef} inputRef={inputRef} disabled={disabled} />
            {primaryAction}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 与既有麦克风按钮（voice-input-button）同一套波形参数。 */
const VOICE_PANEL_WAVEFORM_BARS = [0.35, 0.65, 0.95, 0.55, 0.8, 0.45, 0.9, 0.6, 0.38];

/**
 * 松手后复核态的自动发送倒计时（秒）。
 *
 * 归零即调 `onSubmit`，与点「发送」是同一条路径（因此 `source` 仍是 `voice`，
 * 调用方的打断 / 焦点收尾行为完全一致）。窗口期内想反悔就走原有入口：右下角「取消」、
 * 遥控器「返回」键（映射为 Escape）、「转成文字」—— 它们都收起面板，
 * 本组件随之卸载、interval 被 cleanup 清掉。窗口期内再次按住语音键则回到录音态，
 * 下次松手重新从头倒数。
 */
const VOICE_PANEL_AUTO_SEND_SECONDS = 5;

function formatVoicePanelDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 外设语音面板的呈现层：**结构与样式都在这里**，与输入区保持一致 ——
 * 正文用与输入框相同的字号与行高（chat 13px/1.5、compact 12px/1.625）、
 * 相同的 `--foreground` 0.8 透明度与左右内边距；尾部按钮与输入区工具栏同尺寸同间距，
 * 且与正文之间不加分割线。行高固定 `h-11`，录音/复核切换不跳变。
 *
 * 状态机、ASR 会话与输入区注册都在 `lib/peripherals/voice-panel-provider.tsx`，这里只负责画。
 */
function ChatTextareaVoicePanelView({
  variant,
  panel,
  onCancel,
  onSubmit,
  onToInput,
}: {
  variant: "chat" | "compact";
  panel: ChatTextareaVoicePanel;
  onCancel: () => void;
  onSubmit: () => void;
  /** 「转成文字」：把转写填进输入框（见 ChatTextarea 的同名处理函数）。 */
  onToInput: () => void;
}) {
  const { t } = useTranslation();
  const compact = variant === "compact";
  const recording = panel.phase === "recording";
  const sendRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [seconds, setSeconds] = useState(0);
  const accumulatedSecondsRef = useRef(0);

  /**
   * 复核态的操作按钮支持 ←/→ **循环**切换焦点。
   *
   * 原生 button 不处理方向键，而遥控器的方向键是主要输入方式，所以这里显式接管：
   * 默认焦点在「发送」，按 ← 依次到「取消」「转成文字」，再按 → 回到「发送」。
   * 按钮集合按**视觉顺序**登记进 `footerButtonsRef`（左 → 右）。
   */
  const footerButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const handleFooterKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = footerButtonsRef.current.filter(
      (button): button is HTMLButtonElement => button !== null,
    );
    if (buttons.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const current = buttons.findIndex((button) => button === document.activeElement);
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const next = current === -1 ? 0 : (current + step + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  // 松手后默认焦点落在「发送」：遥控器 OK 即可直接发送。
  useEffect(() => {
    if (panel.phase !== "review") return;
    const frame = requestAnimationFrame(() => sendRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [panel.phase]);

  // 录音计时：从**真正开始收音频**那一刻起算（加载态期间不计时），并跨多次按住累加。
  useEffect(() => {
    if (panel.phase !== "recording" || !panel.audioActive) return;
    const base = accumulatedSecondsRef.current;
    const startedAt = Date.now();
    const timer = setInterval(
      () => setSeconds(base + Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => {
      clearInterval(timer);
      accumulatedSecondsRef.current = base + Math.floor((Date.now() - startedAt) / 1000);
    };
  }, [panel.phase, panel.audioActive]);

  /**
   * 松手后的自动发送倒计时（见 `VOICE_PANEL_AUTO_SEND_SECONDS`）。
   *
   * 只认「复核态 + 有文本 + 无错误」这一个布尔量：尾句定稿、错误上报、用户再次按住
   * （回到录音态）都会让本次倒数作废，并按新状态重来。
   */
  const canAutoSend = !recording && panel.transcript.trim().length > 0 && !panel.error;
  const [autoSendLeft, setAutoSendLeft] = useState<number | null>(null);
  // `onSubmit` 是调用方每次渲染都会重建的函数，直接进依赖会让倒数被无关的重渲染重置，故经 ref 取最新值。
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    if (!canAutoSend) {
      // eslint-disable-next-line react/set-state-in-effect
      setAutoSendLeft(null);
      return;
    }
    // eslint-disable-next-line react/set-state-in-effect
    setAutoSendLeft(VOICE_PANEL_AUTO_SEND_SECONDS);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const left = VOICE_PANEL_AUTO_SEND_SECONDS - Math.floor((Date.now() - startedAt) / 1000);
      if (left > 0) {
        setAutoSendLeft(left);
        return;
      }
      clearInterval(timer);
      onSubmitRef.current();
    }, 1000);
    return () => clearInterval(timer);
  }, [canAutoSend]);

  // 长文本自动跟随：录音期间始终把最新内容滚进视野。
  useEffect(() => {
    if (panel.phase !== "recording") return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [panel.phase, panel.transcript]);

  return (
    // 注意：这里不能要 overflow-hidden —— 呼吸光环是 `-inset-px` 的绝对定位子元素
    // （画在面板边缘之外、与盒子边框重合），被 overflow 裁掉就看不见了；
    // 面板内也没有需要按圆角裁切的内容（正文是自带滚动的子元素）。
    <div
      className="relative flex max-h-full flex-col rounded-lg"
      role="group"
      aria-label={t("chatInput.voicePanelTitle", "Voice input")}
    >
      {/* 录音时的呼吸光环：独立一层 + opacity 动画，不牵动正文与按钮（motion-reduce 只留静态光环） */}
      {recording ? (
        <span
          className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-ring animate-voice-breathe motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : null}
      {/*
        正文：最少约 2 行（`min-h-16`），内容多了内部滚动。
        字号 / 行高 / 颜色 / 内边距对齐输入框本身（见 chatMentionsInputStyle 的 input 段）。
      */}
      <div
        ref={scrollRef}
        className={cn(
          "min-h-16 flex-1 overflow-y-auto whitespace-pre-wrap text-foreground/80",
          compact ? "px-3 pt-3 pb-3 text-xs/relaxed" : "px-4 pt-3 pb-2 text-[13px] leading-normal",
        )}
      >
        {panel.transcript ? (
          // 复核态下**点正文**等同于左下角那个键盘按钮：把转写填进输入框继续编辑
          // （录音中不接管，避免说话时误触把这次采集截断）。
          <p
            onClick={
              recording
                ? undefined
                : () => {
                    // 正在框选文字（多半是想复制）时不接管，否则松手那一下就把面板收掉了
                    if (!window.getSelection()?.isCollapsed) return;
                    onToInput();
                  }
            }
            // 可点但不给 pointer 光标：这里不是链接/按钮，保持与项目其它可点元素一致的 default
            className={cn(
              "-mx-2 px-2 -my-1 py-1 rounded-sm",
              recording ? undefined : "cursor-default hover:text-foreground hover:bg-muted",
            )}
          >
            {panel.transcript}
          </p>
        ) : null}
        {/* 错误单独一行追加在正文之后：不能因为出错就把已经说过的内容遮掉 */}
        {panel.error ? <p className="text-destructive">{panel.error}</p> : null}
        {!panel.transcript && !panel.error ? (
          <p className="text-muted-foreground/70">
            {recording
              ? t("chatInput.voicePanelHint", "Speak now — keep going for as long as you need")
              : t("chatInput.voicePanelEmpty", "No speech detected")}
          </p>
        ) : null}
      </div>

      {/* 尾部状态/操作行：录音与复核共用同一行、同一高度（`h-11`），切换不跳变。 */}
      <div
        className={cn("flex h-11 shrink-0 items-center gap-2", compact ? "px-1.5" : "px-2")}
        onKeyDown={handleFooterKeyDown}
      >
        {recording ? (
          <div className="flex w-full items-center px-2 gap-2 pt-2">
            {panel.audioActive ? (
              // 与 voice-input-button 的波形完全同一套画法：
              // 16px 高的居中盒 + 裁切、柱子 1px 宽（靠 border-l 撑出）+ 75ms 高度过渡。
              <span
                className="flex h-4 items-center justify-center gap-0.5 overflow-hidden"
                aria-hidden="true"
              >
                {VOICE_PANEL_WAVEFORM_BARS.map((scale, index) => (
                  <span
                    key={index}
                    className="rounded-full border-l bg-amber-300 transition-[height] duration-75"
                    style={{
                      height: `${Math.max(2, Math.round(2 + panel.audioLevel * 16 * scale))}px`,
                    }}
                  />
                ))}
              </span>
            ) : (
              <LoaderCircle
                className="size-3.5 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatVoicePanelDuration(seconds)}
            </span>
            <span className="ml-auto truncate text-[11px] text-muted-foreground/60">
              {t("chatInput.voicePanelHoldHint", "Release to finish — everything you said is kept")}
            </span>
          </div>
        ) : (
          // 复核态：左侧「转成文字」（把转写填进输入框继续用键盘编辑），右侧取消 / 发送。
          <>
            <Button
              ref={(element) => {
                footerButtonsRef.current[0] = element;
              }}
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg text-muted-foreground"
              disabled={panel.transcript.length === 0}
              onClick={onToInput}
              aria-label={t("chatInput.voicePanelToInput", "Fill into input box")}
              title={t("chatInput.voicePanelToInput", "Fill into input box")}
            >
              <Keyboard className="size-3.5" />
            </Button>
            <div className="ml-auto flex items-center gap-1.5">
              {/*
                自动发送倒数，紧贴「取消 / 发送」两个按钮：遥控器场景下一眼能看出
                「马上要自动发出去了」，想反悔按 ← 切到「取消」（或遥控器「返回」键）即可，
                倒数随即作废。这里只是只读提示 —— 不改变进入复核态时落在「发送」上的默认焦点，
                也不参与 ←/→ 的按钮循环顺序。
              */}
              {autoSendLeft !== null ? (
                // 数字在文案**最前**，文案只随语言不同；整块紧贴「取消」按钮（这一组是 ml-auto 右对齐），
                // 右端因此被钉死，只要数字位宽不变，整块的位置与宽度就都不变 —— 不需要换成等宽字体。
                // tabular-nums 只是当前字体的数字变体（不换字体），用来兜住「字体回退到比例数字」的情况。
                // 数字与文案之间的 JSX 空白会被丢掉，不会多出空格（渲染为「5秒后自动发送」/「5s until auto-send」）。
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {autoSendLeft}
                  {t("chatInput.voicePanelAutoSendLabel", "s until auto-send")}
                </span>
              ) : null}
              <Button
                ref={(element) => {
                  footerButtonsRef.current[1] = element;
                }}
                size="icon"
                className="size-7 rounded-lg text-muted-foreground bg-muted"
                onClick={onCancel}
                aria-label={t("chatInput.voicePanelCancel", "Cancel")}
                title={t("chatInput.voicePanelCancel", "Cancel")}
              >
                <Undo2 className="size-3.5" />
              </Button>
              <Button
                ref={(element) => {
                  footerButtonsRef.current[2] = element;
                  sendRef.current = element;
                }}
                size="icon"
                className="size-7 rounded-lg"
                disabled={panel.transcript.length === 0}
                onClick={onSubmit}
                aria-label={t("chatInput.voicePanelSend", "Send")}
                title={t("chatInput.voicePanelSend", "Send")}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 建议弹层样式（stack 方向的两个输入框完全一致） */
const suggestionsStyle: MentionsSuggestionsStyle = {
  zIndex: 30,
  left: -1,
  right: -1,
  top: "auto",
  bottom: "100%",
  marginBottom: 4,
  marginTop: 0,
  backgroundColor: "transparent",
  list: {
    backgroundColor: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 7.2,
    fontSize: 12,
    overflow: "hidden",
  },
  item: {
    padding: "6px 12px",
    "&focused": {
      backgroundColor: "var(--accent)",
    },
  },
};

const mentionStyle = {
  backgroundColor: "var(--secondary)",
  boxShadow: "0 0 0 1px var(--ring)",
  opacity: 0.5,
  borderRadius: 2,
  margin: -0.5,
  padding: 0.5,
};

/** chat-input 预设：工具栏在输入区下方流式排布 */
const chatMentionsInputStyle: MentionsInputStyle = {
  control: {
    fontSize: 13,
    lineHeight: "1.5",
  },
  "&multiLine": {
    control: {
      minHeight: 76,
    },
    highlighter: {
      padding: "12px 16px 8px",
      border: "none",
      maxHeight: "80vh",
    },
    input: {
      padding: "12px 16px 8px",
      border: "none",
      outline: "none",
      overflow: "auto",
      maxHeight: "80vh",
      color: "var(--foreground)",
      fontSize: 13,
      lineHeight: "1.5",
      opacity: 0.8,
    },
  },
  suggestions: suggestionsStyle,
};

/** ask-user 预设：输入区 ≈58px（minHeight 108 − 上下内边距 12 + 38），底部预留 38px 给绝对定位的悬浮工具栏 */
const compactMentionsInputStyle: MentionsInputStyle = {
  control: {
    fontSize: 12,
    lineHeight: "1.625",
  },
  "&multiLine": {
    control: {
      minHeight: 108,
    },
    highlighter: {
      padding: "12px 12px 38px",
      border: "none",
      maxHeight: 200,
    },
    input: {
      padding: "12px 12px 38px",
      border: "none",
      outline: "none",
      overflow: "auto",
      maxHeight: 200,
      color: "var(--foreground)",
      fontSize: 12,
      lineHeight: "1.625",
      opacity: 0.8,
      wordBreak: "break-all",
    },
  },
  suggestions: suggestionsStyle,
};
