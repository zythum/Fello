import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Folders, PanelRightClose, SquareChevronRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FilePanel } from "../../session/panel/file-panel/file-panel";
import type { AssistantDiary, AssistantWorkerInfo } from "../../../../shared/schema";
import { useFocusTarget, useFocusTargetRegistry } from "../../../lib/keyboard";
import { CalendarPanel } from "./calendar-panel/calendar-panel";
import { WorkerPanel } from "./worker-panel/worker-panel";

export type PanelTab = "files" | "calendar" | "workers";

interface PanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** 收起按钮的入口，和 Session 的面板一致。 */
  onOpenChange: (open: boolean) => void;
  assistantId: string;
  /** Virtual project id of this assistant's workspace. */
  projectId: string;
  /** Assistant workspace (the virtual project's cwd). */
  workspace: string;
  previewFileId: string | null;
  onPreviewFile: (file: string) => void;
  /** Opens a diary entry in the detail column, with the server time zone used by the calendar. */
  onOpenDiary: (diary: AssistantDiary, timeZone: string) => void;
  /** Opens a worker's read-only transcript in the detail column. */
  onOpenWorker: (worker: AssistantWorkerInfo) => void;
}

export function Panel({
  tab,
  onTabChange,
  onOpenChange,
  assistantId,
  projectId,
  workspace,
  previewFileId,
  onPreviewFile,
  onOpenDiary,
  onOpenWorker,
}: PanelProps) {
  const { t } = useTranslation();
  const { focus } = useFocusTargetRegistry();
  const focusFileTree = useCallback(() => {
    if (tab !== "files") onTabChange("files");
    onOpenChange(true);
    // Wait one frame so the panel is expanded and its inert attribute is gone.
    window.requestAnimationFrame(() => focus("file-tree-content"));
  }, [focus, onOpenChange, onTabChange, tab]);
  useFocusTarget("file-tree", focusFileTree);

  return (
    <div className="flex h-full w-full overflow-hidden flex-col min-h-0 bg-background">
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as PanelTab)}
        className="flex h-full flex-col min-h-0 gap-0"
      >
        <div className="shrink-0 border-b border-border pl-2 pr-1 h-12 flex items-center gap-1">
          <TabsList className="flex-1 gap-0" variant="default">
            <TabsTrigger value="calendar" className="flex-1 min-w-0 text-xs gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {t("assistant.calendar.title", "Calendar")}
              </span>
            </TabsTrigger>
            <TabsTrigger value="files" className="flex-1 min-w-0 text-xs gap-1.5">
              <Folders className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{t("panel.files", "Files")}</span>
            </TabsTrigger>
            <TabsTrigger value="workers" className="flex-1 min-w-0 text-xs gap-1.5">
              <SquareChevronRight className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{t("assistant.workers.title", "Workers")}</span>
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            title={t("panel.collapse", "Collapse panel")}
            aria-label={t("panel.collapse", "Collapse panel")}
            className="mr-0.5 text-sidebar-foreground/60 hover:text-sidebar-foreground/70"
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>

        <TabsContent value="calendar" keepMounted className="flex-1 min-h-0 w-full overflow-hidden">
          <CalendarPanel assistantId={assistantId} onOpenDiary={onOpenDiary} />
        </TabsContent>
        <TabsContent value="files" keepMounted className="flex-1 min-h-0 w-full overflow-hidden">
          <FilePanel
            projectId={projectId}
            cwd={workspace}
            previewFileId={previewFileId}
            onPreviewFile={onPreviewFile}
          />
        </TabsContent>
        <TabsContent value="workers" keepMounted className="flex-1 min-h-0 w-full overflow-hidden">
          <WorkerPanel assistantId={assistantId} onOpenWorker={onOpenWorker} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
