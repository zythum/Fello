import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SettingAssistantWorkerType } from "../../../../shared/schema";
import { request } from "../../../backend";
import { useAppStore } from "../../../store";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GripVertical, Info, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
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
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { extractErrorMessage, generateUUID } from "@/lib/utils";
import { useMessage } from "../../providers/message";
import { SettingsAssistantWorkerDialog } from "./settings-assistant-worker-dialog";

/** Auto-generate a stable, unique worker type id from its display name. */
function generateWorkerTypeId(
  name: string,
  workerTypes: SettingAssistantWorkerType[],
  excludeId: string | null,
): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug || `worker-${generateUUID().replace(/-/g, "").slice(0, 6)}`;
  const used = new Set(
    workerTypes.filter((type) => type.id !== excludeId).map((type) => type.id.toLowerCase()),
  );
  if (!used.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

function WorkerTypeSortableItem({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}) {
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
      <div className="flex w-full items-center">
        <button
          type="button"
          {...attributes}
          {...(!disabled ? listeners : {})}
          disabled={disabled}
          className="-ml-4.5 flex size-4.5 shrink-0 -translate-x-px cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent/50 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          title={t("settings.assistant.workerType.dragToReorder", "Drag to reorder")}
        >
          <GripVertical className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function SettingsAssistant() {
  const { t } = useTranslation();
  const configuredAgents = useAppStore((state) => state.configuredAgents);
  const configuredMcpServers = useAppStore((state) => state.configuredMcpServers);
  const defaultFeatures = useAppStore((state) => state.features);
  const assistant = useAppStore((state) => state.assistant);
  const setAssistant = useAppStore((state) => state.setAssistant);
  const workerTypes = assistant.workerTypes ?? [];
  const defaultWorkerMcpServers = configuredMcpServers
    .filter((server) => !server.disabled)
    .map((server) => server.id);
  const { toast, confirm } = useMessage();
  const [isSaving, setIsSaving] = useState(false);
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false);
  const [workerDialogType, setWorkerDialogType] = useState<SettingAssistantWorkerType | null>(null);
  const [contextMenuWorkerId, setContextMenuWorkerId] = useState<string | null>(null);
  const workerTypeSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const workerAgents = useMemo(
    () => configuredAgents.filter((agent) => !agent.disabled),
    [configuredAgents],
  );

  /**
   * 以补丁形式更新助理配置，始终基于 store 里的最新值合并。
   * 避免输入框 blur 提交后紧接着点击其它控件时，用渲染闭包里的旧值覆盖刚保存的字段。
   */
  const updateAssistant = async (patch: Partial<typeof assistant>): Promise<boolean> => {
    const previous = useAppStore.getState().assistant;
    const normalized = {
      ...previous,
      ...patch,
      workerTypes: patch.workerTypes ?? previous.workerTypes ?? [],
    };
    setAssistant(normalized);
    setIsSaving(true);
    try {
      await request.updateSettings({ assistant: normalized });
      return true;
    } catch (error) {
      setAssistant(previous);
      toast.error(
        extractErrorMessage(error) ||
          t("settings.assistant.updateFailed", "Failed to update Personal Assistant agent."),
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleEnabledChange = (enabled: boolean) => updateAssistant({ enabled });

  const saveWorkerTypes = (nextTypes: SettingAssistantWorkerType[]) =>
    updateAssistant({ workerTypes: nextTypes });

  const handleSaveWorkerType = async (type: SettingAssistantWorkerType): Promise<boolean> => {
    const editingId = workerDialogType?.id ?? null;
    const id = type.id.trim() || generateWorkerTypeId(type.name, workerTypes, editingId);
    const nextType = { ...type, id };
    if (
      workerTypes.some(
        (candidate) =>
          candidate.id.toLowerCase() === id.toLowerCase() && candidate.id !== editingId,
      )
    ) {
      toast.error(
        t(
          "settings.assistant.workerType.duplicate",
          "A worker config with this ID already exists.",
        ),
      );
      return false;
    }
    const nextTypes = editingId
      ? workerTypes.some((candidate) => candidate.id === editingId)
        ? workerTypes.map((candidate) => (candidate.id === editingId ? nextType : candidate))
        : [...workerTypes, nextType]
      : [...workerTypes, nextType];
    return saveWorkerTypes(nextTypes);
  };

  const handleToggleWorkerType = (id: string, enabled: boolean) => {
    const nextTypes = workerTypes.map((type) => (type.id === id ? { ...type, enabled } : type));
    void saveWorkerTypes(nextTypes);
  };

  const handleDeleteWorkerType = async (type: SettingAssistantWorkerType) => {
    const result = await confirm({
      title: t("settings.assistant.workerType.deleteTitle", "Delete worker config"),
      content: t(
        "settings.assistant.workerType.deleteConfirm",
        'Delete "{{name}}"? Existing workers keep their snapshot and are not affected.',
        { name: type.name || type.id },
      ),
      buttons: [
        {
          text: t("settings.assistant.workerType.cancel", "Cancel"),
          value: null,
          variant: "outline",
        },
        {
          text: t("settings.assistant.workerType.delete", "Delete"),
          value: "delete",
          variant: "destructive",
        },
      ],
    });
    if (!result) return;
    const nextTypes = workerTypes.filter((candidate) => candidate.id !== type.id);
    void saveWorkerTypes(nextTypes);
  };

  const openAddWorkerType = () => {
    setWorkerDialogType(null);
    setWorkerDialogOpen(true);
  };

  const openEditWorkerType = (type: SettingAssistantWorkerType) => {
    setWorkerDialogType(type);
    setWorkerDialogOpen(true);
  };

  const handleWorkerTypeDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = workerTypes.findIndex((type) => type.id === active.id);
    const newIndex = workerTypes.findIndex((type) => type.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const nextTypes = [...workerTypes];
    const [moved] = nextTypes.splice(oldIndex, 1);
    nextTypes.splice(newIndex, 0, moved);
    void saveWorkerTypes(nextTypes);
  };

  return (
    <div className="flex h-full flex-1 flex-col">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="mx-auto mb-4 w-full max-w-4xl space-y-6 px-5 py-4">
          <div>
            <h3 className="text-lg font-medium">
              {t("settings.assistant.title", "Personal Assistant")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(
                "settings.assistant.desc",
                "The personal assistant is a resident helper with its own workspace, memory and reminders, taking care of work that doesn't belong to a project. Enable it here and manage the Worker configs it can delegate tasks to; each assistant's source agent, MCP servers and Dream settings are configured from its own page.",
              )}
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.assistant.groupGeneral", "General")}
            </h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium leading-none" htmlFor="assistant-enabled">
                    {t("settings.assistant.enabled", "Enable Personal Assistant")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.enabledDesc",
                      "Connect the assistant automatically while Fello is running.",
                    )}
                  </span>
                </div>
                <Switch
                  id="assistant-enabled"
                  checked={assistant.enabled}
                  disabled={isSaving}
                  onCheckedChange={(checked) => void handleEnabledChange(checked)}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border" />

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                {t("settings.assistant.groupWorker", "Worker configs")}
              </h4>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
                disabled={isSaving}
                onClick={openAddWorkerType}
              >
                <Plus className="size-3" />
                {t("settings.assistant.workerType.add", "Add worker config")}
              </Button>
            </div>
            {workerTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">
                {t(
                  "settings.assistant.workerType.empty",
                  "No worker configs yet. Add one so the assistant can delegate work.",
                )}
              </p>
            ) : (
              <DndContext
                sensors={workerTypeSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleWorkerTypeDragEnd}
              >
                <SortableContext
                  items={workerTypes.map((type) => type.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1">
                    {workerTypes.map((type) => {
                      return (
                        <WorkerTypeSortableItem key={type.id} id={type.id} disabled={isSaving}>
                          <ContextMenu
                            onOpenChange={(open) => setContextMenuWorkerId(open ? type.id : null)}
                          >
                            <ContextMenuTrigger>
                              <div
                                title={type.id}
                                className={`flex cursor-default select-none items-center gap-2 rounded border bg-secondary/50 px-2 py-1.5 ${
                                  contextMenuWorkerId === type.id ? "ring-1 ring-primary" : ""
                                }`}
                              >
                                <div className="flex min-w-0 flex-1 flex-col">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate text-xs font-medium">
                                      {type.name || type.id}
                                    </span>
                                  </div>
                                  <span className="truncate text-[10px] text-muted-foreground/60">
                                    {type.description ||
                                      type.agentId ||
                                      t(
                                        "settings.assistant.workerType.noDescription",
                                        "No description",
                                      )}
                                  </span>
                                </div>
                                <Switch
                                  size="sm"
                                  checked={type.enabled}
                                  disabled={isSaving}
                                  onCheckedChange={(checked) =>
                                    handleToggleWorkerType(type.id, checked)
                                  }
                                />
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-32">
                              <ContextMenuItem
                                disabled={isSaving}
                                onClick={() => openEditWorkerType(type)}
                              >
                                <Pencil className="size-3" />
                                {t("settings.assistant.workerType.edit", "Edit")}
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                variant="destructive"
                                disabled={isSaving}
                                onClick={() => void handleDeleteWorkerType(type)}
                              >
                                <Trash2 className="size-3" />
                                {t("settings.assistant.workerType.delete", "Delete")}
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        </WorkerTypeSortableItem>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground/70">
              <Info className="mt-0.5 size-3 shrink-0" />
              <span>
                {t(
                  "settings.assistant.workerType.tip",
                  "Workers are background agents the assistant can dispatch work to: for long-running tasks such as reading many files, writing long documents or research, it picks one of these configs, creates a worker and gets a report when the work is done. Each config is a reusable bundle — agent, model, permission, features, MCP servers and instructions — and all assistants share them.",
                )}
              </span>
            </p>
          </div>
        </div>
      </ScrollArea>
      <SettingsAssistantWorkerDialog
        key={`${workerDialogOpen ? "open" : "closed"}-${workerDialogType?.id ?? "new"}`}
        open={workerDialogOpen}
        onOpenChange={setWorkerDialogOpen}
        initialType={workerDialogType}
        agents={workerAgents}
        mcpServers={configuredMcpServers}
        defaultFeatures={defaultFeatures}
        defaultMcpServers={defaultWorkerMcpServers}
        onSave={handleSaveWorkerType}
      />
    </div>
  );
}
