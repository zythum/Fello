import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { request, subscribe } from "../../backend";
import type { Schedule } from "../../../shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Item,
  ItemGroup,
  ItemSeparator,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { SettingDialog } from "./common/setting-dialog";
import { Play, Settings2, Trash2, LoaderCircle, Plus, ClockCheck } from "lucide-react";
import { useMessage } from "../providers/message";

export function Automation() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { confirm, toast } = useMessage();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [timezone, setTimezone] = useState("");

  useEffect(() => {
    request
      .getServerTimezone()
      .then(setTimezone)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), 500);
    return () => clearTimeout(timer);
  }, [loading]);

  const loadSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const list = await request.listSchedules();
      setSchedules(list ?? []);
    } catch (err) {
      console.error("Failed to load schedules:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  // Re-render every 30s to keep countdown text up-to-date (no data fetch)
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleChanged = () => void loadSchedules();
    subscribe.on("schedules-changed", handleChanged);
    subscribe.on("task-update", handleChanged);
    return () => {
      subscribe.off("schedules-changed", handleChanged);
      subscribe.off("task-update", handleChanged);
    };
  }, [loadSchedules]);

  const handleTrigger = async (scheduleId: string) => {
    try {
      const task = await request.triggerSchedule({ scheduleId });
      navigate(`/automation/schedule/${scheduleId}/task/${task.id}`);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleDelete = async (schedule: Schedule) => {
    await confirm({
      title: t("automation.deleteTitle", "Delete Schedule"),
      content: t("automation.deleteConfirm", 'Delete "{{name}}" permanently?', {
        name: schedule.name,
      }),
      buttons: [
        { text: t("automation.cancel", "Cancel"), value: null, variant: "outline" },
        {
          text: t("automation.delete", "Delete"),
          value: async () => {
            await request.deleteSchedule({ scheduleId: schedule.id });
            await loadSchedules();
            return "deleted";
          },
          variant: "destructive",
        },
      ],
    });
  };

  const formatNextRun = (schedule: Schedule): string => {
    if (!schedule.nextRunAt) return "-";
    const diff = schedule.nextRunAt - Date.now();
    if (diff <= 0) return t("automation.anyMoment", "Any moment now");
    if (diff < 60 * 1000) return t("automation.lessThanMinute", "Less than 1 min");
    if (diff < 60 * 60 * 1000) return `${Math.ceil(diff / 60000)} min`;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.ceil((diff % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  };

  const getScheduleLabel = (schedule: Schedule): string => {
    if (schedule.cron.type === "manual") return t("automation.manual", "Manual");
    return schedule.cron.expr ?? "-";
  };

  if (loading) {
    return (
      <main className="flex min-w-0 flex-1 flex-col relative overflow-hidden">
        <div
          className="h-12 shrink-0 border-b border-border flex items-center justify-between pl-4 pr-2"
          style={{ WebkitAppRegion: "drag" as any }}
        >
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-medium">{t("automation.title", "Automation")}</h1>
            <span className="text-xs text-muted-foreground font-normal"></span>
          </div>
          <div style={{ WebkitAppRegion: "no-drag" as any }}>
            <Button variant="default" size="sm" className="h-7 text-xs">
              <Plus className="size-3" />
              {t("automation.newSchedule", "New Schedule")}
            </Button>
          </div>
        </div>
        {showLoading && (
          <div className="flex flex-1 items-center justify-center">
            <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col relative overflow-hidden">
      {/* Header */}
      <div
        className="h-12 shrink-0 border-b border-border flex items-center justify-between pl-4 pr-2"
        style={{ WebkitAppRegion: "drag" as any }}
      >
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-medium">{t("automation.title", "Automation")}</h1>
          <span className="text-xs text-muted-foreground font-normal">
            · {t("automation.schedules", "schedules")}: {schedules.length}
          </span>
        </div>
        <div style={{ WebkitAppRegion: "no-drag" as any }}>
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setNewDialogOpen(true)}
          >
            <Plus className="size-3" />
            {t("automation.newSchedule", "New Schedule")}
          </Button>
        </div>
      </div>

      {/* List */}
      {schedules.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4 -mt-10">
            <ClockCheck className="size-6 text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium text-foreground/70 mb-1">
            {t("automation.noSchedules", "No schedules yet")}
          </p>
          <p className="text-xs text-muted-foreground/70 mb-4 max-w-60 text-center">
            {t(
              "automation.emptyHint",
              "Schedule AI tasks to run automatically with cron expressions",
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setNewDialogOpen(true)}
          >
            <Plus className="size-3 mr-1" />
            {t("automation.createFirst", "Create your first schedule")}
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-5 py-4 w-full max-w-4xl mx-auto">
            <ItemGroup className="gap-0">
              {schedules.map((schedule, index) => (
                <Fragment key={schedule.id}>
                  <ContextMenu>
                    <ContextMenuTrigger className="group/ctx">
                      <Item
                        size="sm"
                        className="hover:bg-muted group-data-popup-open/ctx:bg-muted select-none"
                        onClick={() => navigate(`/automation/schedule/${schedule.id}`)}
                      >
                        <ItemContent className="gap-1.5">
                          <ItemTitle className="truncate">
                            {schedule.name}
                            <Badge
                              variant="outline"
                              className="px-1 text-[10px] leading-none uppercase shrink-0"
                            >
                              {schedule.agentId}
                            </Badge>
                          </ItemTitle>
                          <ItemDescription className="line-clamp-1 text-xs">
                            {getScheduleLabel(schedule)}
                            {schedule.lastRunAt && (
                              <>
                                <span className="text-muted-foreground/40 mx-1.5">·</span>
                                {t("automation.cron.lastRun", "Last run")}:{" "}
                                {new Date(schedule.lastRunAt).toLocaleString(i18n.language)}
                              </>
                            )}
                            {schedule.nextRunAt && (
                              <>
                                <span className="text-muted-foreground/40 mx-1.5">·</span>
                                {t("automation.cron.nextRun", "Next run")}:{" "}
                                {new Date(schedule.nextRunAt).toLocaleString(i18n.language)}
                                <span className="text-muted-foreground/40 mx-1.5">·</span>
                                {t("automation.cron.nextRunIn", "Next run in")}{" "}
                                {formatNextRun(schedule)}
                                {timezone && (
                                  <span className="text-muted-foreground/50 ml-0.5">
                                    ({timezone})
                                  </span>
                                )}
                              </>
                            )}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions className="gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-foreground/50 hover:text-foreground hover:bg-accent"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleTrigger(schedule.id);
                            }}
                            title={t("automation.triggerNow", "Trigger now")}
                          >
                            <Play className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-foreground/50 hover:text-foreground hover:bg-accent"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditSchedule(schedule);
                            }}
                            title={t("automation.editSettings", "Edit settings")}
                          >
                            <Settings2 className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive/50 hover:text-destructive hover:bg-destructive/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDelete(schedule);
                            }}
                            title={t("automation.delete", "Delete")}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </ItemActions>
                      </Item>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => void handleTrigger(schedule.id)}>
                        <Play className="size-3.5 mr-2" />
                        {t("automation.triggerNow", "Trigger now")}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => setEditSchedule(schedule)}>
                        <Settings2 className="size-3.5 mr-2" />
                        {t("automation.editSettings", "Edit settings")}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => void handleDelete(schedule)}
                      >
                        <Trash2 className="size-3.5 mr-2" />
                        {t("automation.delete", "Delete")}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  {index < schedules.length - 1 && <ItemSeparator />}
                </Fragment>
              ))}
            </ItemGroup>
          </div>
        </ScrollArea>
      )}

      <SettingDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onSuccess={() => void loadSchedules()}
      />
      {editSchedule && (
        <SettingDialog
          schedule={editSchedule}
          open={editSchedule !== null}
          onOpenChange={(open) => {
            if (!open) setEditSchedule(null);
          }}
          onSuccess={() => void loadSchedules()}
        />
      )}
    </main>
  );
}
