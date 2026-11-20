import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type {
  ApiAgentInfo,
  McpServerInfo,
  SettingAssistantWorkerType,
} from "../../../../shared/schema";
import { request } from "../../../backend";
import { useAppStore } from "../../../store";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
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
import { McpToggleGrid } from "../../common/mcp-toggle-grid";
import { SettingsAssistantWorkerDialog } from "./settings-assistant-worker-dialog";

function isAssistantSourceAgent(agent: unknown): agent is ApiAgentInfo {
  if (!agent || typeof agent !== "object") return false;
  const candidate = agent as {
    type?: unknown;
    provider?: unknown;
    disabled?: unknown;
  };
  return (
    candidate.type === "api" &&
    candidate.provider === "openai-compatible" &&
    candidate.disabled !== true
  );
}

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
  const navigate = useNavigate();
  const configuredAgents = useAppStore((state) => state.configuredAgents);
  const configuredMcpServers = useAppStore((state) => state.configuredMcpServers);
  const setConfiguredMcpServers = useAppStore((state) => state.setConfiguredMcpServers);
  const defaultFeatures = useAppStore((state) => state.features);
  const assistant = useAppStore((state) => state.assistant);
  const setAssistant = useAppStore((state) => state.setAssistant);
  // 旧版后端/热更新缓存可能没有这些字段，读取时统一兜底。
  const assistantMcpServers = assistant.mcpServers ?? [];
  const workerTypes = assistant.workerTypes ?? [];
  const defaultWorkerMcpServers = configuredMcpServers
    .filter((server) => !server.disabled)
    .map((server) => server.id);
  const { toast, confirm } = useMessage();
  const [isSaving, setIsSaving] = useState(false);
  // Null means "no pending edit": the input shows the saved value.
  const [maxContextDraft, setMaxContextDraft] = useState<string | null>(null);
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false);
  const [workerDialogType, setWorkerDialogType] = useState<SettingAssistantWorkerType | null>(null);
  const workerTypeSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const availableAgents = useMemo(
    () => configuredAgents.filter(isAssistantSourceAgent),
    [configuredAgents],
  );
  const workerAgents = useMemo(
    () => configuredAgents.filter((agent) => !agent.disabled),
    [configuredAgents],
  );

  const updateAssistant = async (nextAssistant: typeof assistant): Promise<boolean> => {
    const previous = assistant;
    const normalized = {
      ...nextAssistant,
      mcpServers: nextAssistant.mcpServers ?? [],
      workerTypes: nextAssistant.workerTypes ?? [],
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

  const handleEnabledChange = (enabled: boolean) =>
    updateAssistant({ ...assistant, enabled });

  const handleChange = (sourceAgentId: string | null) => {
    if (!sourceAgentId || sourceAgentId === assistant.sourceAgentId) return;
    return updateAssistant({ ...assistant, sourceAgentId });
  };

  const handleDreamChange = (
    field: "maxContextTokens" | "preferredTime",
    value: number | string,
  ) => {
    const dream = { ...assistant.dream, [field]: value };
    return updateAssistant({ ...assistant, dream });
  };

  const commitMaxContextDraft = () => {
    const draft = maxContextDraft;
    setMaxContextDraft(null);
    if (draft === null) return;
    const value = Number(draft);
    if (Number.isSafeInteger(value) && value > 0 && value !== assistant.dream.maxContextTokens) {
      void handleDreamChange("maxContextTokens", value);
    }
  };

  const saveWorkerTypes = (nextTypes: SettingAssistantWorkerType[]) =>
    updateAssistant({ ...assistant, workerTypes: nextTypes });

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
          "A worker type with this ID already exists.",
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
      title: t("settings.assistant.workerType.deleteTitle", "Delete worker type"),
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

  const toggleAssistantMcp = (id: string, enabled: boolean) => {
    const mcpServers = enabled
      ? [...new Set([...assistantMcpServers, id])]
      : assistantMcpServers.filter((candidate) => candidate !== id);
    void updateAssistant({ ...assistant, mcpServers });
  };

  const handleAddExa = async () => {
    if (configuredMcpServers.some((server) => server.id === "exa")) return;
    const exa: McpServerInfo = {
      id: "exa",
      type: "http",
      url: "https://mcp.exa.ai/mcp",
      headers: {},
      disabled: false,
    };
    const previousAssistant = assistant;
    const previousMcpServers = configuredMcpServers;
    const nextMcpServers = [...configuredMcpServers, exa];
    const nextAssistant = {
      ...assistant,
      mcpServers: [...new Set([...assistantMcpServers, exa.id])],
    };
    setConfiguredMcpServers(nextMcpServers);
    setAssistant(nextAssistant);
    setIsSaving(true);
    try {
      await request.updateSettings({ mcpServers: nextMcpServers, assistant: nextAssistant });
    } catch (error) {
      setConfiguredMcpServers(previousMcpServers);
      setAssistant(previousAssistant);
      toast.error(
        extractErrorMessage(error) ||
          t("settings.assistant.updateFailed", "Failed to update Personal Assistant agent."),
      );
    } finally {
      setIsSaving(false);
    }
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
                "Choose the enabled OpenAI-compatible API agent used by your Personal Assistant.",
              )}
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.assistant.groupGeneral", "General")}
            </h4>
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

          <div className="border-t border-border" />

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.assistant.groupModel", "Model")}
            </h4>
            {availableAgents.length === 0 ? (
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium leading-none">
                    {t("settings.assistant.sourceAgent", "Source agent")}
                  </span>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.empty",
                      "No enabled OpenAI-compatible API agents are available.",
                    )}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => navigate("/settings/agents")}
                >
                  {t("settings.assistant.configureAgents", "Configure agents")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-sm font-medium leading-none"
                    htmlFor="assistant-source-agent"
                  >
                    {t("settings.assistant.sourceAgent", "Source agent")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.sourceAgentDesc",
                      "Its API key and model catalog are reused. Changing it restarts the assistant.",
                    )}
                  </span>
                </div>
                <Select
                  value={assistant.sourceAgentId ?? ""}
                  onValueChange={handleChange}
                  disabled={isSaving}
                >
                  <SelectTrigger id="assistant-source-agent" size="sm" className="w-44 shrink-0">
                    <SelectValue
                      placeholder={t("settings.assistant.selectAgent", "Select an agent")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAgents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="border-t border-border" />

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.assistant.groupMcp", "MCP")}
            </h4>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium leading-none">
                  {t("settings.assistant.mcpServers", "MCP servers")}
                </span>
                <span className="text-xs text-muted-foreground/90">
                  {t(
                    "settings.assistant.mcpServersDesc",
                    "Tools from the selected MCP servers are available to the Personal Assistant.",
                  )}
                </span>
              </div>
              {configuredMcpServers.length === 0 ? (
                <div className="flex items-center justify-between gap-6">
                  <span className="text-xs text-muted-foreground/70">
                    {t("settings.assistant.mcpEmpty", "No MCP servers configured.")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => navigate("/settings/mcp")}
                  >
                    {t("settings.assistant.configureMcp", "Configure MCP servers")}
                  </Button>
                </div>
              ) : (
                <McpToggleGrid
                  servers={configuredMcpServers}
                  selected={assistantMcpServers}
                  disabled={isSaving}
                  onToggle={toggleAssistantMcp}
                />
              )}
              {!configuredMcpServers.some((server) => server.id === "exa") && (
                <div className="flex items-center justify-between gap-6">
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.addExaDesc",
                      "Exa provides web search and page fetching. The free tier needs no API key.",
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
                    disabled={isSaving}
                    onClick={() => void handleAddExa()}
                  >
                    <Plus className="size-3" />
                    {t("settings.assistant.addExa", "Add Exa web search")}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border" />

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.assistant.groupDream", "Dream")}
            </h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-sm font-medium leading-none"
                    htmlFor="assistant-dream-max-context"
                  >
                    {t("settings.assistant.dreamMaxContext", "Max context tokens")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.dreamMaxContextDesc",
                      "Schedule Dream before assistant context reaches this limit.",
                    )}
                  </span>
                </div>
                <Input
                  id="assistant-dream-max-context"
                  type="number"
                  min={1}
                  step={1}
                  className="w-32 shrink-0 h-7 text-xs!"
                  value={maxContextDraft ?? String(assistant.dream.maxContextTokens)}
                  onChange={(event) => setMaxContextDraft(event.target.value)}
                  onBlur={commitMaxContextDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-sm font-medium leading-none"
                    htmlFor="assistant-dream-preferred-time"
                  >
                    {t("settings.assistant.dreamPreferredTime", "Preferred time")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.dreamPreferredTimeDesc",
                      "Preferred local time for a future Dream run.",
                    )}
                  </span>
                </div>
                <Input
                  id="assistant-dream-preferred-time"
                  type="time"
                  // 与 shadcn Time Picker 的 time-picker-optional 一致：原生 time 输入 + 隐藏浏览器自带的时钟图标。
                  // 后端只接受 HH:mm，因此保持默认步长（60s），不能用示例里的 step=1。
                  step={60}
                  className="w-32 shrink-0 h-7 text-xs! appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                  value={assistant.dream.preferredTime}
                  onChange={(event) => void handleDreamChange("preferredTime", event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border" />

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                {t("settings.assistant.groupWorker", "Worker types")}
              </h4>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
                disabled={isSaving}
                onClick={openAddWorkerType}
              >
                <Plus className="size-3" />
                {t("settings.assistant.workerType.add", "Add worker type")}
              </Button>
            </div>
            {workerTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">
                {t(
                  "settings.assistant.workerType.empty",
                  "No worker types yet. Add one so the assistant can delegate work.",
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
                        <WorkerTypeSortableItem
                          key={type.id}
                          id={type.id}
                          disabled={isSaving}
                        >
                          <div
                            title={type.id}
                            className="flex items-center gap-2 rounded border bg-secondary/50 px-2 py-1.5"
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
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-6 text-muted-foreground/60 hover:text-foreground"
                              title={t("settings.assistant.workerType.edit", "Edit worker type")}
                              disabled={isSaving}
                              onClick={() => openEditWorkerType(type)}
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-6 text-muted-foreground/60 hover:text-destructive"
                              title={t("settings.assistant.workerType.delete", "Delete")}
                              disabled={isSaving}
                              onClick={() => void handleDeleteWorkerType(type)}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </WorkerTypeSortableItem>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground/60">
              {t(
                "settings.assistant.workerType.snapshotHint",
                "Existing workers keep the type snapshot they were created with.",
              )}
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
