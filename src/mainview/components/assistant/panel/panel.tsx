import { useTranslation } from "react-i18next";
import { Bell, PanelRightClose } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ReminderPanel } from "./reminder-panel/reminder-panel";

export type PanelTab = "reminders";

interface PanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** 收起按钮的入口，和 Session 的面板一致。 */
  onOpenChange: (open: boolean) => void;
}

export function Panel({ tab, onTabChange, onOpenChange }: PanelProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full overflow-hidden flex-col min-h-0 bg-background">
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as PanelTab)}
        className="flex h-full flex-col min-h-0 gap-0"
      >
        <div className="shrink-0 border-b border-border pl-2 pr-1 h-12 flex items-center gap-1">
          <TabsList className="flex-1 gap-0" variant="default">
            <TabsTrigger value="reminders" className="flex-1 text-xs gap-1.5">
              <Bell className="size-3.5" />
              {t("assistant.reminders.title", "Reminders")}
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
      </Tabs>
    </div>
  );
}
