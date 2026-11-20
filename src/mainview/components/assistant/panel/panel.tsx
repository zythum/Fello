import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Folders, PanelRightClose, SquareChevronRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FilePanel } from "../../session/panel/file-panel/file-panel";
import { ASSISTANT_PROJECT_ID } from "../../../../shared/constants";
import { useFocusTarget, useFocusTargetRegistry } from "../../../lib/keyboard";
import { ReminderPanel } from "./reminder-panel/reminder-panel";
import { WorkerPanel } from "./worker-panel/worker-panel";

export type PanelTab = "files" | "reminders" | "workers";

interface PanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** 收起按钮的入口，和 Session 的面板一致。 */
  onOpenChange: (open: boolean) => void;
  /** Assistant workspace (the virtual project's cwd). */
  workspace: string;
  previewFileId: string | null;
  onPreviewFile: (file: string) => void;
}

export function Panel({
  tab,
  onTabChange,
  onOpenChange,
  workspace,
  previewFileId,
  onPreviewFile,
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
            <TabsTrigger value="reminders" className="flex-1 min-w-0 text-xs gap-1.5">
              <Bell className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {t("assistant.reminders.title", "Reminders")}
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

        <TabsContent value="reminders" keepMounted className="flex-1 min-h-0 w-full overflow-hidden">
          <ReminderPanel />
        </TabsContent>
        <TabsContent value="files" keepMounted className="flex-1 min-h-0 w-full overflow-hidden">
          <FilePanel
            projectId={ASSISTANT_PROJECT_ID}
            cwd={workspace}
            previewFileId={previewFileId}
            onPreviewFile={onPreviewFile}
          />
        </TabsContent>
        <TabsContent value="workers" keepMounted className="flex-1 min-h-0 w-full overflow-hidden">
          <WorkerPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
