import { useState, useCallback } from "react";
import type { ViewMode } from "./file-types";

export interface SelectedLineRange {
  start: number;
  end: number;
  startColumn?: number;
  endColumn?: number;
}

export interface UseFileContextMenuResult {
  selectedText: string;
  selectedLineRange: SelectedLineRange | null;
  /** Callback for ContextMenuTrigger's onContextMenu */
  handleContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Dispatch "fello-add-to-chat" event */
  handleAddToChat: () => void;
  /** Copy selected text to clipboard */
  handleCopy: () => void;
  /** Clear current selection (e.g. on context menu close) */
  clearSelection: () => void;
}

/** Calculate 1-based column position within a .line element from DOM selection */
function getColumnInLine(container: Element, node: Node, offset: number): number | undefined {
  const lineEl =
    node.nodeType === Node.TEXT_NODE
      ? (node.parentElement?.closest(".line") as Element | null)
      : (node as Element).closest(".line");
  if (!lineEl) return undefined;

  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, null);
  let col = 0;
  let found = false;
  let textNode: Node | null = walker.firstChild();
  while (textNode) {
    if (textNode === node) {
      col += offset;
      found = true;
      break;
    }
    col += textNode.textContent?.length ?? 0;
    textNode = walker.nextSibling();
  }

  if (!found) return undefined;
  return col + 1;
}

export function useFileContextMenu(
  file: string | null,
  viewMode: ViewMode,
): UseFileContextMenuResult {
  const [selectedText, setSelectedText] = useState("");
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only code / compare views have selectable line numbers
      if (viewMode !== "code" && viewMode !== "compare") return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectedLineRange(null);
        setSelectedText("");
        return;
      }

      setSelectedText(selection.toString());

      const container = e.currentTarget;
      const range = selection.getRangeAt(0);

      if (!container.contains(range.commonAncestorContainer)) {
        setSelectedLineRange(null);
        return;
      }

      const lines = Array.from(container.querySelectorAll(".line"));
      if (lines.length === 0) {
        setSelectedLineRange(null);
        return;
      }

      let start = -1;
      let end = -1;
      let startColumn: number | undefined;
      let endColumn: number | undefined;

      // Check which line elements are fully contained in the selection
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (selection.containsNode(line, true)) {
          if (start === -1) start = i + 1;
          end = i + 1;
        }
      }

      // Fallback: check the start/end containers
      if (start === -1) {
        const startNode = range.startContainer as Node | null;
        const endNode = range.endContainer as Node | null;

        const startLine =
          startNode?.nodeType === Node.TEXT_NODE
            ? startNode.parentElement?.closest(".line")
            : (startNode as Element)?.closest(".line");
        const endLine =
          endNode?.nodeType === Node.TEXT_NODE
            ? endNode.parentElement?.closest(".line")
            : (endNode as Element)?.closest(".line");

        if (startLine && endLine) {
          start = lines.indexOf(startLine as Element) + 1;
          end = lines.indexOf(endLine as Element) + 1;
          if (start > end) {
            const temp = start;
            start = end;
            end = temp;
          }
        } else if (startLine) {
          start = end = lines.indexOf(startLine as Element) + 1;
        } else if (endLine) {
          start = end = lines.indexOf(endLine as Element) + 1;
        }
      }

      // Compute column positions when we have valid line numbers
      if (start !== -1 && end !== -1 && start > 0 && end > 0) {
        const startNode = range.startContainer;
        const endNode = range.endContainer;

        if (start === end) {
          startColumn = getColumnInLine(container, startNode, range.startOffset);
          endColumn = getColumnInLine(container, endNode, range.endOffset);
          if (startColumn !== undefined && endColumn !== undefined && startColumn > endColumn) {
            const temp = startColumn;
            startColumn = endColumn;
            endColumn = temp;
          }
        } else {
          startColumn = getColumnInLine(container, startNode, range.startOffset);
          endColumn = getColumnInLine(container, endNode, range.endOffset);
        }

        setSelectedLineRange({ start, end, startColumn, endColumn });
      } else {
        setSelectedLineRange(null);
      }
    },
    [viewMode],
  );

  const handleAddToChat = useCallback(() => {
    if (!file || !selectedLineRange) return;
    const { start, end, startColumn, endColumn } = selectedLineRange;
    const suffix =
      start === end
        ? startColumn !== undefined && endColumn !== undefined
          ? `${start}:${startColumn}-${endColumn}`
          : `${start}`
        : startColumn !== undefined && endColumn !== undefined
          ? `${start}:${startColumn}-${end}:${endColumn}`
          : `${start}-${end}`;

    const nodeId = `${file}:${suffix}`;
    const nodeName = `${file}:${suffix}`;
    document.dispatchEvent(
      new CustomEvent("fello-add-to-chat", {
        detail: [{ id: nodeId, name: nodeName, isFolder: false }],
      }),
    );
  }, [file, selectedLineRange]);

  const handleCopy = useCallback(() => {
    if (selectedText) {
      navigator.clipboard.writeText(selectedText);
    }
  }, [selectedText]);

  const clearSelection = useCallback(() => {
    setSelectedLineRange(null);
    setSelectedText("");
  }, []);

  return {
    selectedText,
    selectedLineRange,
    handleContextMenu,
    handleAddToChat,
    handleCopy,
    clearSelection,
  };
}
