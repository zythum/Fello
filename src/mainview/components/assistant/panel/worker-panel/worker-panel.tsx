import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Award, CpuAi, FolderOpen, Loader2, MessageSquareText } from "lucide-react";
import type { AssistantWorkerInfo } from "../../../../../shared/schema";
import { request, subscribe } from "../../../../backend";
import { electron } from "../../../../electron";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  WORKER_CONNECTION_DOT,
  WORKER_CONNECTION_FALLBACKS,
  WORKER_CONNECTION_TEXT,
  WORKER_STATUS_DOT,
  WORKER_STATUS_FALLBACKS,
  WORKER_STATUS_TEXT,
} from "../../worker-status";
import { cn } from "@/lib/utils";

export function WorkerPanel({
  assistantId,
  onOpenWorker,
}: {
  assistantId: string;
  onOpenWorker?: (worker: AssistantWorkerInfo) => void;
}) {
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
                WORKER_STATUS_FALLBACKS[worker.status],
              );
              const connectionLabel = t(
                `assistant.workers.connection.${worker.connectionStatus}`,
                WORKER_CONNECTION_FALLBACKS[worker.connectionStatus],
              );
              const modelLabel =
                worker.modelId ?? t("assistant.workers.agentDefault", "Agent default");
              const typeLabel = worker.typeName ?? worker.typeId ?? "—";
              return (
                <Item
                  key={worker.id}
                  variant="default"
                  size="sm"
                  className="overflow-hidden rounded-lg border border-input bg-card p-0 shadow-2xs"
                >
                  <ItemContent className="min-w-0 gap-0">
                    <div className="flex min-w-0 items-center gap-3 border-b border-border/60 p-2">
                      <span
                        className="min-w-0 truncate text-xs font-medium text-foreground/85"
                        title={worker.name || worker.id}
                      >
                        {worker.name || worker.id}
                      </span>
                      <button
                        type="button"
                        className="flex shrink-0 items-center rounded-sm font-mono text-[10px] whitespace-nowrap text-muted-foreground/70 hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
                        title={`${t("assistant.workers.openDataDir", "Open worker folder")}: ${worker.dataDir}`}
                        onClick={() =>
                          void electron.revealInFinder(worker.dataDir).catch(() => {})
                        }
                      >
                        {worker.id}
                      </button>
                      <span
                        className="ml-auto shrink-0 text-[10px] whitespace-nowrap text-muted-foreground/70"
                        title={turnId ?? undefined}
                      >
                        {t("assistant.workers.detail.turnSummary", "Turn {{count}}", {
                          count: worker.turnCount ?? 0,
                        })}
                      </span>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(38.2%,auto)] divide-x divide-border/60">
                      <div className="flex min-w-0 flex-col justify-center gap-2 p-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Award className="size-3.5 shrink-0 text-muted-foreground/70" />
                          <span
                            className="min-w-0 truncate text-xs font-medium text-foreground/85"
                            title={typeLabel}
                          >
                            {typeLabel}
                          </span>
                        </div>
                        <div
                          className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/70"
                          title={`${worker.agentId} · ${modelLabel}`}
                        >
                          <CpuAi className="size-3.5 shrink-0 text-muted-foreground/70" />
                          <span className="flex min-w-0 items-center gap-0.5">
                            <span className="min-w-0 truncate font-mono">{worker.agentId}</span>
                            <span className="shrink-0 text-[11px] leading-none text-muted-foreground/40">
                              ·
                            </span>
                            <span className="min-w-0 truncate font-mono">{modelLabel}</span>
                          </span>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-col justify-center gap-2 p-2 text-[11px]">
                        <span
                          className={cn(
                            "flex min-w-0 items-center gap-1",
                            WORKER_CONNECTION_TEXT[worker.connectionStatus],
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              WORKER_CONNECTION_DOT[worker.connectionStatus],
                            )}
                          />
                          <span className="truncate">{connectionLabel}</span>
                        </span>

                        <span
                          className={cn(
                            "flex min-w-0 items-center gap-1",
                            WORKER_STATUS_TEXT[worker.status],
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              WORKER_STATUS_DOT[worker.status],
                            )}
                          />
                          <span className="truncate">{statusLabel}</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 border-t border-border/60 p-2">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left font-mono text-[10px] text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
                        title={`${t("assistant.workers.revealWorkspace", "Reveal in Finder")}: ${worker.cwd}`}
                        onClick={() => void electron.revealInFinder(worker.cwd).catch(() => {})}
                      >
                        <FolderOpen className="size-3 shrink-0 text-muted-foreground/50" />
                        <span className="min-w-0 truncate">{worker.cwd}</span>
                      </button>

                      {onOpenWorker && (
                        <Button
                          variant="outline"
                          size="xs"
                          className="h-6 shrink-0 gap-1 px-2 -m-1 ml-1 text-[10px] font-normal"
                          onClick={() => onOpenWorker(worker)}
                        >
                          <MessageSquareText className="size-3" />
                          {t("assistant.workers.viewConversation", "View chat")}
                        </Button>
                      )}
                    </div>

                    {worker.lastError && (
                      <div
                        className="border-t border-border/60 p-2 text-[10px] text-destructive/80 line-clamp-2 whitespace-pre-wrap wrap-break-word"
                        title={worker.lastError}
                      >
                        {worker.lastError}
                      </div>
                    )}
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
