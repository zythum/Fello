import { useTranslation } from "react-i18next";
import { Folders, SquareTerminal, LayoutList } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FilePanel } from "./file-panel/file-panel";
import { TerminalPanel } from "./terminal-panel/terminal-panel";
import { ContextPanel } from "../context/context-panel";

export type PanelTab = "files" | "terminal" | "context";

interface PanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  projectId: string | null;
  sessionId: string | null;
  previewFileId: string | null;
  activeTerminalId: string | null;
  onPreviewFile: (file: string) => void;
  onSelectTerminal: (terminalId: string) => void;
}

export function Panel({
  tab,
  onTabChange,
  projectId,
  sessionId,
  previewFileId,
  activeTerminalId,
  onPreviewFile,
  onSelectTerminal,
}: PanelProps) {
  const { t } = useTranslation();

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground border-l border-border bg-background">
        <span>{t("panel.noProjectSelected", "No project selected")}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col min-h-0 bg-background">
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as PanelTab)}
        className="flex h-full flex-col min-h-0 gap-0"
      >
        <div className="shrink-0 border-b border-border px-2 h-12 flex items-center">
          <TabsList className="w-full gap-0" variant="default">
            <TabsTrigger value="files" className="flex-1 text-xs gap-1.5">
              <Folders className="size-3.5" />
              {t("panel.files", "Files")}
            </TabsTrigger>
            <TabsTrigger value="terminal" className="flex-1 text-xs gap-1.5">
              <SquareTerminal className="size-3.5" />
              {t("panel.terminal", "Terminal")}
            </TabsTrigger>
            <TabsTrigger value="context" className="flex-1 text-xs gap-1.5">
              <LayoutList className="size-3.5" />
              {t("panel.context", "Context")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="files" className="flex-1 min-h-0">
          <FilePanel
            projectId={projectId}
            previewFileId={previewFileId}
            onPreviewFile={onPreviewFile}
          />
        </TabsContent>

        <TabsContent value="terminal" className="flex-1 min-h-0">
          <TerminalPanel
            projectId={projectId}
            activeTerminalId={activeTerminalId}
            onSelectTerminal={onSelectTerminal}
          />
        </TabsContent>

        <TabsContent value="context" className="flex-1 min-h-0">
          {sessionId ? (
            <ContextPanel sessionId={sessionId} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t("context.empty", "No context data yet")}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
