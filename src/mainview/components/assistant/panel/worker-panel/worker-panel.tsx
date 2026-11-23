import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2 } from "lucide-react";
import type { AssistantWorkerInfo } from "../../../../../shared/schema";
import { request, subscribe } from "../../../../backend";
import { electron } from "../../../../electron";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<AssistantWorkerInfo["status"], string> = {
  running: "text-sky-500",
  awaiting_permission: "text-amber-500",
  idle: "text-muted-foreground",
  failed: "text-destructive",
  closed: "text-muted-foreground/60",
  interrupted: "text-amber-500",
};

const STATUS_FALLBACKS: Record<AssistantWorkerInfo["status"], string> = {
  running: "Running",
  awaiting_permission: "Awaiting permission",
  idle: "Idle",
  failed: "Failed",
  closed: "Closed",
  interrupted: "Interrupted",
};

const CONNECTION_DOTS: Record<AssistantWorkerInfo["connectionStatus"], string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500",
  disconnected: "bg-muted-foreground/30",
};

const CONNECTION_FALLBACKS: Record<AssistantWorkerInfo["connectionStatus"], string> = {
  connected: "Connected",
  connecting: "Connecting",
  disconnected: "Disconnected",
};

export function WorkerPanel({ assistantId }: { assistantId: string }) {
  const { t } = useTranslation();
  const [workers, setWorkers] = useState<AssistantWorkerInfo[] | null>(null);

  useEffect(() => {
    let active = true;
    const onChanged = (payload: { assistantId: string; workers: AssistantWorkerInfo[] }) => {
      if (active && payload.assistantId === assistantId) setWorkers(payload.workers);
    };
    subscribe.on("assistant-workers-changed", onChanged);
    void request
      .listAssistantWorkers({ assistantId })
      .then((list) => {
        if (active) setWorkers(list);
      })
      .catch(() => {
        if (active) setWorkers([]);
      });
    return () => {
      active = false;
      subscribe.off("assistant-workers-changed", onChanged);
    };
  }, [assistantId]);

  if (workers === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="flex-1 min-h-0" viewportClassName="p-3">
        {workers.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("assistant.workers.empty", "No workers yet")}
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {workers.map((worker) => {
              const turnId = worker.currentTurnId ?? worker.lastTurnId;
              const statusLabel = t(
                `assistant.workers.status.${worker.status}`,
                STATUS_FALLBACKS[worker.status],
              );
              const connectionLabel = t(
                `assistant.workers.connection.${worker.connectionStatus}`,
                CONNECTION_FALLBACKS[worker.connectionStatus],
              );
              const modelLabel =
                worker.modelId ?? t("assistant.workers.agentDefault", "Agent default");
              const typeLabel = worker.typeName ?? worker.typeId ?? "—";
              return (
                <Item
                  key={worker.id}
                  variant="muted"
                  size="sm"
                  className="rounded-md border-foreground/15 p-2 shadow-2xs"
                >
                  <ItemContent className="min-w-0 gap-1.5">
                    <ItemTitle className="flex w-full items-center justify-between gap-2 border-b border-border/60 pb-1.5 text-sm font-medium">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="min-w-0 truncate"
                          title={worker.name ? `${worker.name} (${worker.id})` : worker.id}
                        >
                          {worker.name || worker.id}
                        </span>
                        <span
                          className="flex shrink-0 items-center gap-1 text-[10px] font-normal text-muted-foreground/60"
                          title={connectionLabel}
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              CONNECTION_DOTS[worker.connectionStatus],
                            )}
                          />
                          <span>{connectionLabel}</span>
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[11px] font-medium",
                          STATUS_STYLES[worker.status],
                        )}
                      >
                        {statusLabel}
                      </span>
                    </ItemTitle>

                    <dl className="grid grid-cols-[minmax(3rem,auto)_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px] leading-snug">
                      <dt className="text-[10px] text-muted-foreground/60">
                        {t("assistant.workers.id", "ID")}
                      </dt>
                      <dd className="min-w-0 text-foreground/80">
                        <button
                          type="button"
                          className="group/id flex w-full min-w-0 items-center gap-1 rounded-sm text-left font-mono hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
                          title={`${t("assistant.workers.openDataDir", "Open worker folder")}: ${worker.dataDir}`}
                          onClick={() => void electron.revealInFinder(worker.dataDir).catch(() => {})}
                        >
                          <span className="min-w-0 truncate">{worker.id}</span>
                          <FolderOpen className="size-3 shrink-0 text-muted-foreground/50 transition-colors group-hover/id:text-foreground/70" />
                        </button>
                      </dd>

                      <dt className="text-[10px] text-muted-foreground/60">
                        {t("assistant.workers.type", "Type")}
                      </dt>
                      <dd
                        className="min-w-0 truncate text-foreground/80"
                        title={worker.typeId ?? undefined}
                      >
                        {typeLabel}
                      </dd>

                      <dt className="text-[10px] text-muted-foreground/60">
                        {t("assistant.workers.agent", "Agent")}
                      </dt>
                      <dd
                        className="min-w-0 truncate font-mono text-foreground/80"
                        title={worker.agentId}
                      >
                        {worker.agentId}
                      </dd>

                      <dt className="text-[10px] text-muted-foreground/60">
                        {t("assistant.workers.model", "Model")}
                      </dt>
                      <dd
                        className="min-w-0 truncate font-mono text-foreground/80"
                        title={modelLabel}
                      >
                        {modelLabel}
                      </dd>

                      <dt className="text-[10px] text-muted-foreground/60">
                        {t("assistant.workers.workspace", "Workspace")}
                      </dt>
                      <dd className="min-w-0 text-foreground/80">
                        <button
                          type="button"
                          className="group/workspace flex w-full min-w-0 items-center gap-1 rounded-sm text-left font-mono hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
                          title={`${t("assistant.workers.revealWorkspace", "Reveal in Finder")}: ${worker.cwd}`}
                          onClick={() => void electron.revealInFinder(worker.cwd).catch(() => {})}
                        >
                          <span className="min-w-0 truncate">{worker.cwd}</span>
                          <FolderOpen className="size-3 shrink-0 text-muted-foreground/50 transition-colors group-hover/workspace:text-foreground/70" />
                        </button>
                      </dd>

                      <dt className="text-[10px] text-muted-foreground/60">
                        {t("assistant.workers.turn", "Turn")}
                      </dt>
                      <dd
                        className="flex min-w-0 items-center gap-1 text-foreground/80"
                        title={turnId ?? undefined}
                      >
                        <span className="shrink-0">
                          {t("assistant.workers.turnCount", "Turn {{count}}", {
                            count: worker.turnCount ?? 0,
                          })}
                        </span>
                        {turnId && (
                          <>
                            <span className="text-muted-foreground/30">·</span>
                            <span className="min-w-0 truncate font-mono">
                              {turnId.slice(0, 8)}
                            </span>
                          </>
                        )}
                      </dd>

                      {worker.lastError && (
                        <>
                          <dt className="text-[10px] text-destructive/80">
                            {t("assistant.workers.error", "Error")}
                          </dt>
                          <dd
                            className="min-w-0 whitespace-pre-wrap wrap-break-word text-destructive/80 line-clamp-3"
                            title={worker.lastError}
                          >
                            {worker.lastError}
                          </dd>
                        </>
                      )}
                    </dl>
                  </ItemContent>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </ScrollArea>
    </div>
  );
}
