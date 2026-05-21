import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type {
  HttpMcpServerInfo,
  McpServerInfo,
  StdioMcpServerInfo,
} from "../../../../shared/schema";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Plus, Pencil, Trash2, BookmarkPlus } from "lucide-react";
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
import { SettingsMcpStdioDialog } from "./settings-mcp-stdio-dialog";
import { SettingsMcpHttpDialog } from "./settings-mcp-http-dialog";

function McpSortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : ("auto" as const),
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-1 w-full">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-accent/50 text-muted-foreground shrink-0"
          title="Drag to reorder"
        >
          <GripVertical className="size-3.5 -ml-1" />
        </button>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}

function isStdioMcp(mcp: McpServerInfo): mcp is StdioMcpServerInfo {
  return mcp.type === "stdio";
}

function isHttpMcp(mcp: McpServerInfo): mcp is HttpMcpServerInfo {
  return mcp.type === "http";
}

export function SettingsMcp() {
  const { t } = useTranslation();
  const { configuredMcpServers, setConfiguredMcpServers } = useAppStore();
  const { toast } = useMessage();
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);

  const [dialogOriginalId, setDialogOriginalId] = useState<string | null>(null);
  const [stdioDialogOpen, setStdioDialogOpen] = useState(false);
  const [httpDialogOpen, setHttpDialogOpen] = useState(false);
  const [stdioDialogItem, setStdioDialogItem] = useState<StdioMcpServerInfo | null>(null);
  const [httpDialogItem, setHttpDialogItem] = useState<HttpMcpServerInfo | null>(null);

  useEffect(() => {
    setMcpServers(configuredMcpServers);
  }, [configuredMcpServers]);

  const handleSave = async (updatedMcpServers: McpServerInfo[]) => {
    try {
      await request.updateSettings({ mcpServers: updatedMcpServers });
      setConfiguredMcpServers(updatedMcpServers);
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.mcp.updateFailed", "Failed to update configuration."),
      );
    }
  };

  const closeDialogs = () => {
    setStdioDialogOpen(false);
    setHttpDialogOpen(false);
    setStdioDialogItem(null);
    setHttpDialogItem(null);
    setDialogOriginalId(null);
  };

  const upsertMcp = async (nextMcp: McpServerInfo) => {
    const duplicate = mcpServers.some(
      (item) =>
        item.id === nextMcp.id && item.id !== dialogOriginalId && !item.id.startsWith("__new_mcp_"),
    );
    if (duplicate) {
      toast.error(t("settings.mcp.errorDuplicateId", "A server with this ID already exists."));
      return;
    }

    const isNew = dialogOriginalId === null;
    const updated = isNew
      ? [...mcpServers, nextMcp]
      : mcpServers.map((item) => (item.id === dialogOriginalId ? nextMcp : item));

    setMcpServers(updated);
    closeDialogs();
    await handleSave(updated);
  };

  const openAddStdioDialog = () => {
    setDialogOriginalId(null);
    setHttpDialogItem(null);
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

  const openAddHttpDialog = () => {
    setDialogOriginalId(null);
    setStdioDialogItem(null);
    setHttpDialogItem({
      id: "",
      type: "http",
      url: "",
      headers: {},
      disabled: false,
    });
    setHttpDialogOpen(true);
  };

  const openRecommendedHttpDialog = (id: string, url: string) => {
    setDialogOriginalId(null);
    setStdioDialogItem(null);
    setHttpDialogItem({
      id,
      type: "http",
      url,
      headers: {},
      disabled: false,
    });
    setHttpDialogOpen(true);
  };

  const openEditDialog = (mcp: McpServerInfo) => {
    setDialogOriginalId(mcp.id);
    if (isStdioMcp(mcp)) {
      setHttpDialogItem(null);
      setStdioDialogItem({ ...mcp });
      setStdioDialogOpen(true);
      return;
    }
    if (isHttpMcp(mcp)) {
      setStdioDialogItem(null);
      setHttpDialogItem({ ...mcp });
      setHttpDialogOpen(true);
    }
  };

  const getServerSummary = (mcp: McpServerInfo): string => {
    if (mcp.type === "http") return mcp.url;
    return [mcp.command, ...(mcp.args || [])].join(" ");
  };

  const handleDelete = async (id: string) => {
    const updated = mcpServers.filter((a) => a.id !== id);
    setMcpServers(updated);
    await handleSave(updated);
  };

  const handleToggleDisabled = async (id: string, disabled: boolean) => {
    const updated = mcpServers.map((a) => (a.id === id ? { ...a, disabled } : a));
    setMcpServers(updated);
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
      const oldIndex = mcpServers.findIndex((a) => a.id === active.id);
      const newIndex = mcpServers.findIndex((a) => a.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const updated = [...mcpServers];
        const [moved] = updated.splice(oldIndex, 1);
        updated.splice(newIndex, 0, moved);
        setMcpServers(updated);
        await handleSave(updated);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-5 py-4 w-full max-w-4xl mx-auto">
        <h3 className="text-lg font-medium">{t("settings.mcp.title", "MCP Servers")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.mcp.desc", "Manage MCP server configurations and startup commands.")}
        </p>
      </div>

      <div className="space-y-2 px-4 w-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between p-1">
          <h3 className="text-xs text-foreground/50">
            {t("settings.mcp.description", "Configure MCP Servers")}
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={openAddStdioDialog}
              className="h-7 text-xs text-foreground/70"
            >
              <Plus className="mr-1 size-3" />
              {t("settings.mcp.addStdioMcp", "Add Stdio MCP")}
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={openAddHttpDialog}
              className="h-7 text-xs text-foreground/70"
            >
              <Plus className="mr-1 size-3" />
              {t("settings.mcp.addHttpMcp", "Add HTTP MCP")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted hover:text-foreground h-7 w-7 text-xs text-foreground/70">
                <BookmarkPlus className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-50">
                <DropdownMenuItem onClick={() => openRecommendedHttpDialog("exa", "https://mcp.exa.ai/mcp")}>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="truncate flex flex-row items-center">
                      <span>{t("settings.mcp.recommended.exa.name", "Exa")}</span>
                      <span className="text-[10px] text-muted-foreground/40! font-normal ml-1.5">· exa.ai</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 font-normal truncate">{t("settings.mcp.recommended.exa.desc", "Exa MCP Server — AI Web Search")}</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                items={mcpServers.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                {mcpServers.map((mcp) => (
                  <McpSortableItem key={mcp.id} id={mcp.id}>
                    <ContextMenu>
                      <ContextMenuTrigger>
                        <div className="flex items-center gap-2 rounded-lg border p-1.5 min-h-10 text-sm bg-secondary/50 cursor-default select-none overflow-hidden">
                          <span
                            className={`font-bold text-xs ml-1 truncate shrink-0 max-w-24 select-none ${mcp.disabled ? "text-muted-foreground/50 line-through" : ""}`}
                          >
                            {mcp.id}
                          </span>
                          <span className="text-[10px] flex-1 w-0 text-muted-foreground font-mono truncate">
                            {getServerSummary(mcp)}
                          </span>
                          <div className="flex items-center gap-1 shrink-0 ml-1">
                            <Switch
                              size="sm"
                              checked={!mcp.disabled}
                              onCheckedChange={(checked) => handleToggleDisabled(mcp.id, !checked)}
                            />
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-32">
                        <ContextMenuItem onClick={() => openEditDialog(mcp)}>
                          <Pencil className="size-3" />
                          {t("common.edit", "Edit")}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem variant="destructive" onClick={() => handleDelete(mcp.id)}>
                          <Trash2 className="size-3" />
                          {t("common.delete", "Delete")}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </McpSortableItem>
                ))}
              </SortableContext>
            </DndContext>
            {mcpServers.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("settings.mcp.noMcpServers", "No MCP servers configured")}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <SettingsMcpStdioDialog
        open={stdioDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
          else setStdioDialogOpen(open);
        }}
        initialMcp={stdioDialogItem}
        onSave={upsertMcp}
      />

      <SettingsMcpHttpDialog
        open={httpDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
          else setHttpDialogOpen(open);
        }}
        initialMcp={httpDialogItem}
        onSave={upsertMcp}
      />
    </div>
  );
}
