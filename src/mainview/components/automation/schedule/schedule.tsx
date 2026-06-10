import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Outlet, useLocation } from "react-router-dom";
import { request, subscribe } from "../../../backend";
import type { Schedule, Task } from "../../../../shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { SettingDialog } from "../common/setting-dialog";
import {
  LoaderCircle,
  ArrowLeft,
  Play,
  Settings2,
  CheckCircle2,
  XCircle,
  Trash2,
  FileText,
} from "lucide-react";
import { useMessage } from "../../providers/message";

export function Schedule() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm } = useMessage();

  const hasTaskRoute = location.pathname.includes("/task/");

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [timezone, setTimezone] = useState("");

  useEffect(() => {
    request
      .getServerTimezone()
      .then(setTimezone)
      .catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    if (!scheduleId) return;
    try {
      const [scheduleData, tasksData] = await Promise.all([
        request.listSchedules().then((list) => list.find((s: Schedule) => s.id === scheduleId)),
        request.getTasks({ scheduleId }),
      ]);
      setSchedule(scheduleData ?? null);
      setTasks(tasksData ?? []);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);
  useEffect(() => {
    const h = () => void loadData();
    subscribe.on("schedules-changed", h);
    return () => subscribe.off("schedules-changed", h);
  }, [loadData]);
  useEffect(() => {
    const h = (p: any) => {
      if (p.scheduleId === scheduleId) {
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === p.task.id);
          if (idx >= 0) {
            const n = [...prev];
            n[idx] = p.task;
            return n;
          }
          return [p.task, ...prev];
        });
      }
    };
    subscribe.on("task-update", h);
    return () => subscribe.off("task-update", h);
  }, [scheduleId]);

  const handleTrigger = async () => {
    if (!scheduleId) return;
    try {
      await request.triggerSchedule({ scheduleId });
    } catch {
      /* ignore */
    }
  };

  const handleDeleteTask = async (task: Task) => {
    if (!scheduleId) return;
    await confirm({
      title: t("automation.deleteTaskTitle", "Delete Task"),
      content: t("automation.deleteTaskConfirm", "Delete this task permanently?"),
      buttons: [
        { text: t("automation.cancel", "Cancel"), value: null, variant: "outline" },
        {
          text: t("automation.delete", "Delete"),
          value: async () => {
            await request.deleteTask({ scheduleId, taskId: task.id });
            setTasks((prev) => prev.filter((t) => t.id !== task.id));
            return "deleted";
          },
          variant: "destructive",
        },
      ],
    });
  };

  const getTaskIcon = (task: Task) => {
    switch (task.status) {
      case "running":
        return <LoaderCircle className="size-3.5 animate-spin text-blue-500" />;
      case "success":
        return <CheckCircle2 className="size-3.5 text-green-500" />;
      case "error":
        return <XCircle className="size-3.5 text-red-500" />;
    }
  };

  if (loading) {
    return (
      <main className="flex min-w-0 flex-1 flex-col relative overflow-hidden">
        <div
          className="h-12 shrink-0 border-b border-border flex items-center gap-1 px-2"
          style={{ WebkitAppRegion: "drag" }}
        >
          <div style={{ WebkitAppRegion: "no-drag" }}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => navigate("/automation")}
            >
              <ArrowLeft className="size-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0"></div>
          <div className="text-xs text-muted-foreground hidden sm:block shrink-0 mr-2"></div>
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" as any }}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title={t("automation.editSettings", "Edit settings")}
            >
              <Settings2 className="size-3.5" />
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={handleTrigger}
            >
              <Play className="size-3 mr-1" />
              {t("automation.triggerNow", "Trigger now")}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (!schedule) {
    return (
      <main className="flex min-w-0 flex-1 flex-col items-center justify-center relative overflow-hidden gap-3">
        <div className="absolute left-0 top-0 right-0 h-12" style={{ WebkitAppRegion: "drag" }} />
        <p className="text-sm font-normal text-muted-foreground">
          {t("automation.scheduleNotFound", "Schedule not found")}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => navigate("/automation")}
        >
          <ArrowLeft className="size-3" />
          {t("automation.back", "Back")}
        </Button>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col relative overflow-hidden">
      {/* Header */}
      <div
        className="h-12 shrink-0 border-b border-border flex items-center gap-1 px-2"
        style={{ WebkitAppRegion: "drag" }}
      >
        <div style={{ WebkitAppRegion: "no-drag" }}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => navigate("/automation")}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h1 className="text-sm font-medium truncate">{schedule.name}</h1>
          <Badge variant="outline" className="px-1 text-[10px] leading-none uppercase shrink-0">
            {schedule.agentId}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground hidden sm:block shrink-0 mr-2">
          {schedule.cron.type === "cron" ? schedule.cron.expr : t("automation.manual", "Manual")}
          {schedule.nextRunAt && (
            <>
              <span className="text-muted-foreground/40 mx-1">·</span>
              {t("automation.cron.nextRun", "Next")}:{" "}
              {new Date(schedule.nextRunAt).toLocaleString(i18n.language)}
              {timezone && <span className="text-muted-foreground/50 ml-0.5">({timezone})</span>}
            </>
          )}
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" as any }}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setEditDialogOpen(true)}
            title={t("automation.editSettings", "Edit settings")}
          >
            <Settings2 className="size-3.5" />
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={handleTrigger}
          >
            <Play className="size-3 mr-1" />
            {t("automation.triggerNow", "Trigger now")}
          </Button>
        </div>
      </div>

      {/* Layout: taskList | task (Outlet) */}
      {tasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center px-6">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Play className="size-6 text-muted-foreground/60" />
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "automation.noTasksDesc",
              'No runs yet. Click "Trigger now" to start the first run.',
            )}
          </p>
        </div>
      ) : (
        <ResizablePanelGroup className="flex-1 min-h-0">
          {/* Left: Task list */}
          <ResizablePanel
            id="taskList"
            groupResizeBehavior="preserve-pixel-size"
            defaultSize={200}
            minSize={180}
            maxSize={400}
          >
            <div className="h-full flex flex-col">
              <ScrollArea className="flex-1">
                <div>
                  {[...tasks]
                    .sort((a, b) => b.startedAt - a.startedAt)
                    .map((task) => {
                      const isActive = location.pathname.endsWith(`/task/${task.id}`);
                      return (
                        <ContextMenu key={task.id}>
                          <ContextMenuTrigger
                            render={<div />}
                            className={`group border-b border-border flex h-10 cursor-default items-center px-3 text-xs font-normal transition-colors ${
                              isActive
                                ? "bg-accent/70 hover:bg-accent text-accent-foreground/95"
                                : "text-foreground/70 hover:bg-accent hover:text-foreground"
                            }`}
                            onClick={() =>
                              navigate(`/automation/schedule/${scheduleId}/task/${task.id}`)
                            }
                          >
                            <div className="flex min-w-0 flex-1 items-baseline gap-2">
                              <div className="truncate">
                                {new Date(task.startedAt).toLocaleDateString(i18n.language)}
                              </div>
                              <div className="text-muted-foreground truncate text-[11px]">
                                {new Date(task.startedAt).toLocaleTimeString(i18n.language)}
                              </div>
                            </div>
                            <div className="shrink-0 ml-2">{getTaskIcon(task)}</div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              variant="destructive"
                              disabled={task.status === "running"}
                              onClick={() => void handleDeleteTask(task)}
                            >
                              <Trash2 className="size-3.5 mr-2" />
                              {t("automation.delete", "Delete")}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>

          {<ResizableHandle className="bg-border/70" />}

          {/* Right: Task detail (Outlet) or empty placeholder */}
          <ResizablePanel id="right">
            {hasTaskRoute ? (
              <Outlet />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <FileText className="size-6 text-muted-foreground/60" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("automation.selectTaskToPreview", "Select a task to preview files")}
                </p>
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <SettingDialog
        schedule={schedule}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSuccess={() => void loadData()}
      />
    </main>
  );
}
