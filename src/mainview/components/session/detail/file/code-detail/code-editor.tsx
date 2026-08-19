import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { initMonacoEditor, monaco, getFiletypeFromFileName } from "@/lib/monaco-editor";

export interface CodeEditorHandle {
  getValue: () => string;
  setValue: (value: string) => void;
  /** 标记当前内容为已保存基准（更新 dirty 状态），不触碰编辑器内容/光标/undo 栈 */
  markSaved: () => void;
  isDirty: () => boolean;
}

interface CodeEditorProps {
  content: string;
  filename: string;
  isDark: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * 基于 monaco-editor-core + @shikijs/monaco 的轻量文本编辑器。
 * 只负责编辑与高亮（无语言服务），保存等操作由父组件通过 ref 驱动。
 */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { content, filename, isDark, onDirtyChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const dirtyRef = useRef(false);
  // 编辑基准内容：初始为传入 content，保存后更新为已保存内容，用于 dirty 判断
  const baselineRef = useRef(content);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  // 创建编辑器（仅挂载一次；content/filename 视为初始值）
  useEffect(() => {
    let cancelled = false;
    let editor: monaco.editor.IStandaloneCodeEditor | null = null;

    initMonacoEditor()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        editor = monaco.editor.create(containerRef.current, {
          value: content,
          language: getFiletypeFromFileName(filename) ?? "text",
          theme: isDark ? "github-dark" : "github-light",
          automaticLayout: true,
          fontSize: 12,
          lineHeight: 20,
          fontFamily:
            '"SF Mono", Monaco, Consolas, "Ubuntu Mono", "Liberation Mono", "Courier New", monospace',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "off",
          tabSize: 2,
          insertSpaces: true,
          renderLineHighlight: "line",
          padding: { top: 8, bottom: 8 },
          glyphMargin: false,
          folding: true,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          fixedOverflowWidgets: true,
          bracketPairColorization: { enabled: false },
          // 显示缩进指示线（垂直虚线），配合 renderWhitespace 便于对齐和识别混用缩进
          guides: { indentation: true, bracketPairs: true, bracketPairsHorizontal: true },
          // 显示 tab / 空格缩进符号（tab → 箭头、空格 → 圆点），便于区分混用缩进
          renderWhitespace: "all",
          hover: { enabled: "on" },
          find: { addExtraSpaceOnTop: false },
        });
        editorRef.current = editor;

        editor.onDidChangeModelContent(() => {
          const dirty = editor!.getValue() !== baselineRef.current;
          if (dirty !== dirtyRef.current) {
            dirtyRef.current = dirty;
            onDirtyChangeRef.current?.(dirty);
          }
        });
      })
      .catch((err) => {
        console.error("Failed to init Monaco editor:", err);
      });

    return () => {
      cancelled = true;
      editor?.dispose();
      editorRef.current = null;
      dirtyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题切换：shikiToMonaco 已 patch monaco.editor.setTheme 以同步 Shiki 高亮主题
  useEffect(() => {
    monaco.editor.setTheme(isDark ? "github-dark" : "github-light");
  }, [isDark]);

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => editorRef.current?.getValue() ?? content,
      setValue: (value: string) => {
        editorRef.current?.setValue(value);
        baselineRef.current = value;
        dirtyRef.current = false;
        onDirtyChangeRef.current?.(false);
      },
      markSaved: () => {
        baselineRef.current = editorRef.current?.getValue() ?? baselineRef.current;
        dirtyRef.current = false;
        onDirtyChangeRef.current?.(false);
      },
      isDirty: () => dirtyRef.current,
    }),
    [content],
  );

  return <div ref={containerRef} className="h-full w-full" />;
});
