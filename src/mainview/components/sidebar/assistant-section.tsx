import { useTranslation } from "react-i18next";
import { Eye, MessageCircle, Pencil, Power, Trash2, UserRoundPlus } from "lucide-react";
import type { AssistantConfig } from "../../../shared/schema";
import { request } from "../../backend";
import { useAppStore } from "../../store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useMessage } from "../providers/message";
import { AssistantHoverDetails } from "./assistant-hover-details";
import { AssistantRowStatus } from "./row-status";
import { assistantHoverId, sidebarNavigationItemKey } from "./sidebar-constants";
import type { SidebarHoverState, SidebarNavigationBinding } from "./sidebar-types";
import { getErrorMessage } from "./sidebar-utils";

type AssistantSectionProps = {
  assistants: AssistantConfig[];
  activeAssistantId: string | null;
  activeIlinkSessionId: string | null;
  ilinkConnected: boolean;
  hover: SidebarHoverState;
  navigation: SidebarNavigationBinding;
  onOpenNewAssistant: () => void;
  onSelectAssistant: (assistant: AssistantConfig) => void;
  onSetActiveIlinkSession: (sessionId: string) => void;
  onNavigate: (path: string) => void;
};

/** 个人助理区：固定在「项目」上方，每个助理一行；全局关闭时由 Sidebar 决定不渲染。 */
export function AssistantSection({
  assistants,
  activeAssistantId,
  activeIlinkSessionId,
  ilinkConnected,
  hover,
  navigation,
  onOpenNewAssistant,
  onSelectAssistant,
  onSetActiveIlinkSession,
  onNavigate,
}: AssistantSectionProps) {
  const { t } = useTranslation();
  const { prompt, confirm, toast } = useMessage();
  const setAssistants = useAppStore((s) => s.setAssistants);
  const { hoverId, setHoverId, contextMenuId, setContextMenuId, hoveredTriggerIdRef } = hover;
  const { itemRefs, onItemKeyDown } = navigation;

  /**
   * 重命名个人助理：名称保存在该助理的 config.json，立即生效（类似 session title）。
   * 先乐观更新 store，失败再回滚。
   */
  const handleRenameAssistant = async (assistant: AssistantConfig) => {
    const newName = await prompt({
      title: t("sidebar.renameAssistant", "Rename Assistant"),
      content: t("sidebar.enterNewAssistantName", "Enter a new name for your personal assistant."),
      defaultValue: assistant.name,
      validate: (val) =>
        val.trim() ? undefined : t("sidebar.assistantNameEmpty", "Name cannot be empty"),
    });
    if (!newName) return;
    const trimmed = newName.trim();
    if (trimmed === assistant.name) return;

    const previous = useAppStore.getState().assistants;
    setAssistants(
      previous.map((item) => (item.id === assistant.id ? { ...item, name: trimmed } : item)),
    );
    try {
      await request.updateAssistantConfig({
        assistantId: assistant.id,
        patch: { name: trimmed },
      });
    } catch (err) {
      setAssistants(previous);
      toast.error(
        getErrorMessage(err, t("sidebar.renameAssistantFailed", "Failed to rename the assistant.")),
      );
    }
  };

  const handleToggleAssistantDisabled = async (assistant: AssistantConfig) => {
    try {
      await request.updateAssistantConfig({
        assistantId: assistant.id,
        patch: { disabled: !assistant.disabled },
      });
    } catch (err) {
      toast.error(
        getErrorMessage(err, t("sidebar.updateAssistantFailed", "Failed to update the assistant.")),
      );
    }
  };

  const handleDeleteAssistant = async (assistant: AssistantConfig) => {
    await confirm({
      title: t("sidebar.deleteAssistant", "Delete Assistant"),
      content: t(
        "sidebar.deleteAssistantConfirm",
        'Delete "{{name}}"? This also removes its reminders, diary, memory, history and workers.',
        { name: assistant.name },
      ),
      buttons: [
        { text: t("sidebar.cancel"), value: null, variant: "outline" },
        {
          text: t("sidebar.delete"),
          variant: "destructive",
          value: async () => {
            try {
              await request.deleteAssistant({ assistantId: assistant.id });
              if (activeAssistantId === assistant.id) onNavigate("/");
              return "deleted";
            } catch (err) {
              toast.error(
                getErrorMessage(
                  err,
                  t("sidebar.deleteAssistantFailed", "Failed to delete the assistant."),
                ),
              );
              return null;
            }
          },
        },
      ],
    });
  };

  return (
    <>
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-xs font-normal tracking-wide text-sidebar-foreground/40 uppercase select-none">
          {t("sidebar.assistant")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          tabIndex={-1}
          className="size-6 -mr-1 text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70"
          onClick={onOpenNewAssistant}
          aria-label={t("sidebar.addAssistant", "Add assistant")}
        >
          <UserRoundPlus className="size-3.5" />
        </Button>
      </div>
      <div role="tree" aria-label={t("sidebar.assistant")} className="px-1.5 pt-2">
        <div className="space-y-0.5">
          {assistants.length === 0 && (
            <div className="p-1.5 text-xs opacity-45 text-sidebar-foreground/70 select-none">
              {t("sidebar.noAssistant", "No assistants yet")}
            </div>
          )}
          {assistants.map((assistant) => {
            const currentHoverId = assistantHoverId(assistant.id);
            const active = activeAssistantId === assistant.id;
            const disabled = assistant.disabled;
            return (
              <HoverCard
                key={assistant.id}
                open={hoverId === currentHoverId}
                onOpenChange={(open) => {
                  if (open) {
                    if (contextMenuId === null) setHoverId(currentHoverId);
                  } else if (
                    hoverId === currentHoverId &&
                    hoveredTriggerIdRef.current !== currentHoverId
                  ) {
                    setHoverId(null);
                  }
                }}
              >
                <HoverCardTrigger render={<div />} delay={0} closeDelay={100}>
                  <ContextMenu
                    onOpenChange={(open) => {
                      setContextMenuId(open ? currentHoverId : null);
                      if (open) {
                        setHoverId(null);
                      } else if (hoveredTriggerIdRef.current === currentHoverId) {
                        setHoverId(currentHoverId);
                      }
                    }}
                  >
                    <ContextMenuTrigger
                      render={
                        <div
                          ref={(element) => {
                            const key = sidebarNavigationItemKey({
                              type: "assistant",
                              id: assistant.id,
                            });
                            if (element) itemRefs.current.set(key, element);
                            else itemRefs.current.delete(key);
                          }}
                          tabIndex={-1}
                          role="treeitem"
                          aria-level={1}
                          aria-disabled={disabled || undefined}
                          aria-current={active ? "page" : undefined}
                          onClick={() => {
                            if (!disabled) onSelectAssistant(assistant);
                          }}
                          onKeyDown={(event) =>
                            onItemKeyDown(event, {
                              type: "assistant",
                              id: assistant.id,
                            })
                          }
                          onPointerEnter={() => {
                            hoveredTriggerIdRef.current = currentHoverId;
                          }}
                          onPointerLeave={() => {
                            hoveredTriggerIdRef.current = null;
                          }}
                          className={cn(
                            "flex h-7 cursor-default items-center justify-between rounded-md pl-1.5 pr-2 text-xs transition-colors outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
                            disabled && "opacity-45",
                            active
                              ? "font-medium bg-sidebar-accent text-sidebar-accent-foreground"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95",
                            hoverId === currentHoverId || contextMenuId === currentHoverId
                              ? "bg-sidebar-accent"
                              : "",
                          )}
                        />
                      }
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <AssistantRowStatus
                          assistantId={assistant.id}
                          disabled={disabled}
                          isActive={activeAssistantId === assistant.id}
                        />
                        <span className="min-w-0 flex-1 truncate leading-normal select-none">
                          {assistant.name}
                        </span>
                        {activeIlinkSessionId === assistant.id && (
                          <MessageCircle className="size-3 shrink-0 text-green-500" />
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      {!disabled && (
                        <ContextMenuItem
                          onClick={() => onSelectAssistant(assistant)}
                          className="font-medium text-foreground"
                        >
                          <Eye className="size-3" />
                          {t("sidebar.openAssistant", "Open Assistant")}
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem onClick={() => void handleRenameAssistant(assistant)}>
                        <Pencil className="size-3" />
                        {t("sidebar.rename", "Rename")}
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => void handleToggleAssistantDisabled(assistant)}
                      >
                        <Power className="size-3" />
                        {disabled
                          ? t("sidebar.enableAssistant", "Enable Assistant")
                          : t("sidebar.disableAssistant", "Disable Assistant")}
                      </ContextMenuItem>
                      {!disabled && ilinkConnected && activeIlinkSessionId !== assistant.id && (
                        <ContextMenuItem onClick={() => void onSetActiveIlinkSession(assistant.id)}>
                          <MessageCircle className="size-3" />
                          {t("sidebar.ilinkSetActive", "Set as WeChat Active")}
                        </ContextMenuItem>
                      )}
                      {!disabled && ilinkConnected && activeIlinkSessionId === assistant.id && (
                        <ContextMenuItem onClick={() => void onSetActiveIlinkSession("")}>
                          <MessageCircle className="size-3 text-green-500" />
                          {t("sidebar.ilinkUnsetActive", "Unset WeChat Active")}
                        </ContextMenuItem>
                      )}
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => void handleDeleteAssistant(assistant)}
                      >
                        <Trash2 className="size-3" />
                        {t("sidebar.deleteAssistant", "Delete Assistant")}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </HoverCardTrigger>
                <HoverCardContent
                  side="right"
                  align="start"
                  sideOffset={12}
                  alignOffset={0}
                  className="w-54 p-3"
                >
                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-medium leading-snug line-clamp-2 wrap-break-word">
                      <span>{assistant.name}</span>
                    </div>
                    <AssistantHoverDetails assistant={assistant} />
                    {!disabled && ilinkConnected && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                        <MessageCircle
                          className={cn(
                            "size-3 shrink-0",
                            activeIlinkSessionId === assistant.id && "text-green-500",
                          )}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            void onSetActiveIlinkSession(
                              activeIlinkSessionId === assistant.id ? "" : assistant.id,
                            )
                          }
                          className="min-w-0 flex-1 truncate text-left transition-colors hover:text-foreground"
                        >
                          {t(
                            activeIlinkSessionId === assistant.id
                              ? "sidebar.ilinkActiveStatus"
                              : "sidebar.ilinkInactiveStatus",
                            activeIlinkSessionId === assistant.id
                              ? "WeChat Active"
                              : "Not WeChat Active",
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </HoverCardContent>
              </HoverCard>
            );
          })}
        </div>
      </div>
    </>
  );
}
