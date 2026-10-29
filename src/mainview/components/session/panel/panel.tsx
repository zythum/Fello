import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Folders, PanelRightClose, SquareTerminal } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useFocusTarget, useFocusTargetRegistry } from "../../../lib/keyboard";
import { FilePanel } from "./file-panel/file-panel";
import { TerminalPanel } from "./terminal-panel/terminal-panel";

export type PanelTab = "files" | "terminal";

interface PanelProps {
  /** 面板是否展开。收起时宽度归零但仍挂载；聚焦命令会先把它展开再聚焦。 */
  open: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** 收起 / 展开的统一入口；聚焦命令也会用它把收起的面板叫回来。 */
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  previewFileId: string | null;
  activeTerminalId: string | null;
  onPreviewFile: (file: string) => void;
  onSelectTerminal: (terminalId: string) => void;
}

export function Panel({
  open,
  tab,
  onTabChange,
  onOpenChange,
  projectId,
  previewFileId,
  activeTerminalId,
  onPreviewFile,
  onSelectTerminal,
}: PanelProps) {
  const { t } = useTranslation();
  const { focus } = useFocusTargetRegistry();
  const focusFileTree = useCallback(() => {
    const focusFileTreeContent = () => focus("file-tree-content");
    const needsLayout = !open || tab !== "files";
    if (tab !== "files") onTabChange("files");
    if (!open) onOpenChange(true);
    // 面板刚展开 / 正要切页时不立即聚焦：等提交后的布局生效、inert 撤掉，再落到目标上
    if (needsLayout) {
      window.requestAnimationFrame(focusFileTreeContent);
      return;
    }

    focusFileTreeContent();
  }, [focus, onOpenChange, onTabChange, open, tab]);

  // 收起时仍保留 focus target：命令会先展开面板再聚焦（见 focusFileTree / focusTerminalList）
  useFocusTarget("file-tree", focusFileTree, Boolean(projectId));

  const focusTerminalList = useCallback(() => {
    const focusTerminalListContent = () => focus("terminal-list-content");
    const needsLayout = !open || tab !== "terminal";
    if (tab !== "terminal") onTabChange("terminal");
    if (!open) onOpenChange(true);
    // 同 focusFileTree：等面板展开、inert 撤掉后再聚焦终端列表
    if (needsLayout) {
      window.requestAnimationFrame(focusTerminalListContent);
      return;
    }

    focusTerminalListContent();
  }, [focus, onOpenChange, onTabChange, open, tab]);

  useFocusTarget("terminal-list", focusTerminalList, Boolean(projectId));

  if (!projectId) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="shrink-0 border-b border-border pl-2 pr-1 h-12 flex items-center justify-end">
          <CollapseButton onClick={() => onOpenChange(false)} />
        </div>
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <span>{t("panel.noProjectSelected", "No project selected")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden flex-col min-h-0 bg-background">
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as PanelTab)}
        className="flex h-full flex-col min-h-0 gap-0"
      >
        <div className="shrink-0 border-b border-border pl-2 pr-1 h-12 flex items-center gap-1">
          <TabsList className="flex-1 gap-0" variant="default">
            <TabsTrigger value="files" className="flex-1 text-xs gap-1.5">
              <Folders className="size-3.5" />
              {t("panel.files", "Files")}
            </TabsTrigger>
            <TabsTrigger value="terminal" className="flex-1 text-xs gap-1.5">
              <SquareTerminal className="size-3.5" />
              {t("panel.terminal", "Terminal")}
            </TabsTrigger>
          </TabsList>
          <CollapseButton onClick={() => onOpenChange(false)} />
        </div>

        <TabsContent value="files" keepMounted className="flex-1 min-h-0 w-full overflow-hidden">
          <FilePanel
            projectId={projectId}
            previewFileId={previewFileId}
            onPreviewFile={onPreviewFile}
          />
        </TabsContent>

        <TabsContent value="terminal" keepMounted className="flex-1 min-h-0 w-full overflow-hidden">
          <TerminalPanel
            projectId={projectId}
            activeTerminalId={activeTerminalId}
            onSelectTerminal={onSelectTerminal}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** 收起按钮：有 project 时嵌在标签栏右侧，无 project 时占位在同一高度，避免两套入口。 */
function CollapseButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={t("panel.collapse", "Collapse panel")}
      aria-label={t("panel.collapse", "Collapse panel")}
      className="mr-0.5 text-sidebar-foreground/60 hover:text-sidebar-foreground/70"
    >
      <PanelRightClose className="size-4" />
    </Button>
  );
}
