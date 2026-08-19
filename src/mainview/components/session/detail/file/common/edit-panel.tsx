import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { extractErrorMessage } from "@/lib/utils";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { request } from "../../../../../backend";
import { useMessage } from "../../../../providers/message";
import { LoadingState } from "./loading-state";
import type { CodeEditorHandle } from "../code-detail/code-editor";

// 懒加载 monaco 编辑器（monaco-editor-core 体积较大，独立 chunk 按需加载）
const CodeEditor = lazy(() =>
  import("../code-detail/code-editor").then((m) => ({ default: m.CodeEditor })),
);

/** 可编辑文件的最大字节数，超过则隐藏编辑入口（主线程 Shiki tokenize 大文件会卡顿） */
export const MAX_EDIT_SIZE = 1024 * 1024;

export interface EditPanelHandle {
  /** 保存当前编辑内容，返回是否成功 */
  save: () => Promise<boolean>;
  /** 当前是否有未保存的更改 */
  isDirty: () => boolean;
}

interface EditPanelProps {
  projectId: string;
  filePath: string;
  content: string;
  onCancel: () => void;
  /** 保存成功后的回调（父组件用于刷新文件内容） */
  onSaved?: () => void;
  /** 内容加载中（切换文件等场景）：先显示加载态，避免编辑器以空内容创建 */
  loading?: boolean;
}

/**
 * 文本文件编辑面板：工具栏（保存/取消）+ Monaco 编辑器。
 * 文本类（CodeDetail）与 Markdown（MarkdownDetail）共用；
 * 保存、Cmd/Ctrl+S、dirty 状态均在内部维护，父组件可通过 ref 查询/保存。
 */
export const EditPanel = forwardRef<EditPanelHandle, EditPanelProps>(function EditPanel(
  { projectId, filePath, content, loading = false, onCancel, onSaved },
  ref,
) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const { toast } = useMessage();
  const editorRef = useRef<CodeEditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleDirtyChange = useCallback((nextDirty: boolean) => {
    setDirty(nextDirty);
  }, []);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (saving) return false;
    const editor = editorRef.current;
    if (!editor) return false;
    // 以编辑器自身的 dirty 基线判断：初始 content 在首次保存后已过期，不能作为比较基准
    if (!editor.isDirty()) {
      handleDirtyChange(false);
      return true;
    }
    const nextContent = editor.getValue();
    setSaving(true);
    try {
      await request.writeFile({ projectId, relativePath: filePath, content: nextContent });
      // 只更新 dirty 基准，不重置编辑器（setValue 会把光标/滚动位置重置回左上角）
      editor.markSaved();
      handleDirtyChange(false);
      onSaved?.();
      toast.success(t("fileDetail.saveSuccess"));
      return true;
    } catch (err) {
      console.error("Save failed:", extractErrorMessage(err));
      toast.error(t("fileDetail.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [projectId, filePath, saving, toast, t, onSaved, handleDirtyChange]);

  // Cmd/Ctrl + S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        // 有模态弹窗（如设置对话框）时让位，避免误触发编辑器保存
        if (document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  useImperativeHandle(
    ref,
    () => ({
      save: () => handleSave(),
      isDirty: () => dirty,
    }),
    [handleSave, dirty],
  );

  return (
    <div className="flex h-full flex-col">
      {/* 编辑工具栏 */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-muted/30 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {dirty ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
              <span className="truncate">{t("fileDetail.unsaved")}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span className="truncate">{t("fileDetail.saved")}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="xs" variant="ghost" onClick={onCancel} disabled={saving}>
            {t("filePanel.cancel")}
          </Button>
          <Button size="xs" onClick={() => void handleSave()} disabled={!dirty || saving}>
            {saving ? (
              <Loader2 className="mr-0.5 size-3.5 animate-spin" />
            ) : (
              <Save className="mr-0.5 size-3.5" />
            )}
            {saving ? t("fileDetail.saving") : t("fileDetail.save")}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {loading ? (
          <LoadingState />
        ) : (
          <Suspense fallback={<LoadingState />}>
            <CodeEditor
              // 切换文件时以 filePath 重挂，避免复用旧文件的编辑器内容/语言
              key={filePath}
              ref={editorRef}
              content={content}
              filename={filePath}
              isDark={resolvedTheme === "dark"}
              onDirtyChange={handleDirtyChange}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
});
