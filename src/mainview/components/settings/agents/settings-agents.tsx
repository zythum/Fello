import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { AgentInfo, ApiAgentInfo, StdioAgentInfo } from "../../../../shared/schema";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Plus, Pencil, Trash2, RefreshCw, XCircle } from "lucide-react";
import { extractErrorMessage } from "@/lib/utils";
import { useMessage } from "../../providers/message";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { SettingsAgentStdioDialog } from "./settings-agent-stdio-dialog";
import { SettingsAgentApiDialog } from "./settings-agent-api-dialog";

function AgentSortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-1 w-full">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-accent/50 text-muted-foreground shrink-0"
          title={t("settings.agents.dragToReorder", "Drag to reorder")}
        >
          <GripVertical className="size-3.5 -ml-1" />
        </button>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}

function isStdioAgent(agent: AgentInfo): agent is StdioAgentInfo {
  return agent.type === "stdio";
}

function isApiAgent(agent: AgentInfo): agent is ApiAgentInfo {
  return agent.type === "api";
}

export function SettingsAgents() {
  const { t } = useTranslation();
  const { configuredAgents, sessions, setConfiguredAgents } = useAppStore();
  const { toast, confirm } = useMessage();
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const [contextMenuAgentId, setContextMenuAgentId] = useState<string | null>(null);
  const [dialogOriginalId, setDialogOriginalId] = useState<string | null>(null);
  const [stdioDialogOpen, setStdioDialogOpen] = useState(false);
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [stdioDialogItem, setStdioDialogItem] = useState<StdioAgentInfo | null>(null);
  const [apiDialogItem, setApiDialogItem] = useState<ApiAgentInfo | null>(null);

  useEffect(() => {
    setAgents(configuredAgents);
  }, [configuredAgents]);

  const handleSave = async (updatedAgents: AgentInfo[]) => {
    try {
      await request.updateSettings({ agents: updatedAgents });
      setConfiguredAgents(updatedAgents);
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.agents.updateFailed", "Failed to update configuration."),
      );
    }
  };

  const closeDialogs = () => {
    setStdioDialogOpen(false);
    setApiDialogOpen(false);
    setStdioDialogItem(null);
    setApiDialogItem(null);
    setDialogOriginalId(null);
  };

  const upsertAgent = async (nextAgent: AgentInfo) => {
    const duplicate = agents.some(
      (item) =>
        item.id === nextAgent.id &&
        item.id !== dialogOriginalId &&
        !item.id.startsWith("__new_agent_"),
    );
    if (duplicate) {
      toast.error(t("settings.agents.errorDuplicateId"));
      return;
    }

    const isNew = dialogOriginalId === null;
    const updated = isNew
      ? [...agents, nextAgent]
      : agents.map((item) => (item.id === dialogOriginalId ? nextAgent : item));

    setAgents(updated);
    closeDialogs();
    await handleSave(updated);
  };

  const openAddStdioDialog = () => {
    setDialogOriginalId(null);
    setApiDialogItem(null);
    setStdioDialogItem({
      id: "",
      type: "stdio",
      command: "",
      args: [],
      env: {},
      disabled: false,
    });
    setStdioDialogOpen(true);
  };

  const openAddApiDialog = () => {
    setDialogOriginalId(null);
    setStdioDialogItem(null);
    setApiDialogItem({
      id: "",
      type: "api",
      provider: "openai-compatible",
      baseUrl: "",
      apiKey: "",
      headers: {},
      disabled: false,
    });
    setApiDialogOpen(true);
  };

  const openEditDialog = (agent: AgentInfo) => {
    setDialogOriginalId(agent.id);
    if (isStdioAgent(agent)) {
      setApiDialogItem(null);
      setStdioDialogItem({ ...agent });
      setStdioDialogOpen(true);
      return;
    }
    if (isApiAgent(agent)) {
      setStdioDialogItem(null);
      setApiDialogItem({ ...agent });
      setApiDialogOpen(true);
    }
  };

  const handleDelete = async (id: string) => {
    // 从 store 中计算该 Agent 关联的会话数量
    const sessionCount = sessions.filter((s) => s.agentId === id).length;

    const content =
      sessionCount > 0
        ? t(
            "settings.agents.confirmDeleteDescWithSessions",
            "Are you sure you want to delete this agent? {{count}} session(s) will also be deleted. This action cannot be undone.",
            { count: sessionCount },
          )
        : t(
            "settings.agents.confirmDeleteDesc",
            "Are you sure you want to delete this agent? This action cannot be undone.",
          );

    const result = await confirm({
      title: t("settings.agents.confirmDeleteTitle", "Delete Agent"),
      content,
      buttons: [
        { text: t("message.cancel", "Cancel"), value: null, variant: "outline" },
        { text: t("settings.agents.delete", "Delete"), value: "confirm", variant: "destructive" },
      ],
    });
    if (!result) return;
    const updated = agents.filter((a) => a.id !== id);
    setAgents(updated);
    await handleSave(updated);
  };

  const handleReset = async (id: string) => {
    try {
      await request.resetAgent({ agentId: id });
      toast.success(t("settings.agents.resetSuccess", "Agent reset."));
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.agents.resetFailed", "Failed to reset agent."),
      );
    }
  };

  const handleDeleteAllSessions = async (id: string) => {
    const result = await confirm({
      title: t("settings.agents.confirmDeleteAllSessionsTitle", "Delete All Sessions"),
      content: t(
        "settings.agents.confirmDeleteAllSessionsDesc",
        "All sessions for this agent will be permanently deleted. This action cannot be undone.",
      ),
      buttons: [
        { text: t("message.cancel", "Cancel"), value: null, variant: "outline" },
        { text: t("settings.agents.delete", "Delete"), value: "confirm", variant: "destructive" },
      ],
    });
    if (!result) return;
    try {
      const res = await request.clearAgentSessions({ agentId: id });
      toast.success(
        t(
          "settings.agents.deleteAllSessionsSuccess",
          "{{count}} session(s) deleted.",
          { count: res.deletedSessionIds.length },
        ),
      );
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.agents.deleteAllSessionsFailed", "Failed to clear sessions."),
      );
    }
  };

  const handleToggleDisabled = async (id: string, disabled: boolean) => {
    const updated = agents.map((a) => (a.id === id ? { ...a, disabled } : a));
    setAgents(updated);
    await handleSave(updated);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = agents.findIndex((a) => a.id === active.id);
      const newIndex = agents.findIndex((a) => a.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const updated = [...agents];
        const [moved] = updated.splice(oldIndex, 1);
        updated.splice(newIndex, 0, moved);
        setAgents(updated);
        await handleSave(updated);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-5 py-4 w-full max-w-4xl mx-auto">
        <h3 className="text-lg font-medium">{t("settings.agents.title", "Agents")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.agents.desc", "Manage agent configurations and startup commands.")}
        </p>
      </div>

      <div className="space-y-2 px-4 w-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between p-1">
          <h3 className="text-xs text-foreground/50">
            {t("settings.agents.description", "Configure agents")}
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={openAddStdioDialog}
              className="h-7 text-xs text-foreground/70"
            >
              <Plus className="mr-1 size-3" />
              {t("settings.agents.addStdioAgent", "Add Stdio Agent")}
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={openAddApiDialog}
              className="h-7 text-xs text-foreground/70"
            >
              <Plus className="mr-1 size-3" />
              {t("settings.agents.addApiAgent", "Add API Agent")}
            </Button>
          </div>
        </div>
        <div className="border-t border-border -mx-4"></div>
      </div>

      <ScrollArea className="flex-1 w-full overflow-hidden">
        <div className="w-full max-w-4xl mx-auto">
          <div className="space-y-3 m-5 pb-6">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={agents.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                {agents.map((agent) => (
                  <AgentSortableItem key={agent.id} id={agent.id}>
                    <ContextMenu onOpenChange={(open) => setContextMenuAgentId(open ? agent.id : null)}>
                      <ContextMenuTrigger>
                        <div className={`flex items-center gap-2 rounded-lg border p-1.5 min-h-10 text-sm bg-secondary/50 cursor-default select-none overflow-hidden ${contextMenuAgentId === agent.id ? "ring-1 ring-primary" : ""}`}>
                          <span
                            className={`font-bold text-xs ml-1 truncate shrink-0 max-w-24 select-none ${agent.disabled ? "text-muted-foreground/50 line-through" : ""}`}
                          >
                            {agent.id}
                          </span>
                          <span className="text-[10px] flex-1 w-0 text-muted-foreground font-mono truncate">
                            {isStdioAgent(agent)
                              ? [agent.command, ...(agent.args || [])].join(" ")
                              : `api:${agent.provider} ${agent.baseUrl}`}
                          </span>
                          <div className="flex items-center gap-1 shrink-0 ml-1">
                            <Switch
                              size="sm"
                              checked={!agent.disabled}
                              onCheckedChange={(checked) =>
                                handleToggleDisabled(agent.id, !checked)
                              }
                            />
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-40">
                        <ContextMenuItem onClick={() => openEditDialog(agent)}>
                          <Pencil className="size-3" />
                          {t("settings.agents.edit", "Edit")}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleReset(agent.id)}>
                          <RefreshCw className="size-3" />
                          {t("settings.agents.reset", "Reset Agent")}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleDeleteAllSessions(agent.id)}>
                          <XCircle className="size-3" />
                          {t("settings.agents.deleteAllSessions", "Delete All Sessions")}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => handleDelete(agent.id)}
                        >
                          <Trash2 className="size-3" />
                          {t("settings.agents.delete", "Delete")}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </AgentSortableItem>
                ))}
              </SortableContext>
            </DndContext>
            {agents.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("settings.agents.noAgents")}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <SettingsAgentStdioDialog
        open={stdioDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
          else setStdioDialogOpen(open);
        }}
        initialAgent={stdioDialogItem}
        onSave={upsertAgent}
      />

      <SettingsAgentApiDialog
        open={apiDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
          else setApiDialogOpen(open);
        }}
        initialAgent={apiDialogItem}
        onSave={upsertAgent}
      />
    </div>
  );
}
