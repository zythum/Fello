import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, SquareChevronRight } from "lucide-react";
import type { AssistantWorkerInfo } from "../../../../../shared/schema";
import { request, subscribe } from "../../../../backend";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
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

export function WorkerPanel() {
  const { t } = useTranslation();
  const [workers, setWorkers] = useState<AssistantWorkerInfo[] | null>(null);

  useEffect(() => {
    let active = true;
    const onChanged = (list: AssistantWorkerInfo[]) => {
      if (active) setWorkers(list);
    };
    subscribe.on("assistant-workers-changed", onChanged);
    void request
      .listAssistantWorkers()
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
  }, []);

  if (workers === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {workers.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("assistant.workers.empty", "No workers yet")}
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {workers.map((worker) => (
              <Item key={worker.id} variant="outline" size="sm" className="overflow-hidden">
                <ItemContent className="min-w-0">
                  <ItemTitle className="flex w-full items-center justify-between gap-2 font-normal">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <SquareChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
                      <span className="min-w-0 truncate">{worker.name || worker.id}</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[10px] font-medium",
                        STATUS_STYLES[worker.status],
                      )}
                    >
                      {t(
                        `assistant.workers.status.${worker.status}`,
                        STATUS_FALLBACKS[worker.status],
                      )}
                    </span>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none flex min-w-0 flex-col gap-1 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          CONNECTION_DOTS[worker.connectionStatus],
                        )}
                      />
                      <span className="shrink-0">
                        {t(
                          `assistant.workers.connection.${worker.connectionStatus}`,
                          CONNECTION_FALLBACKS[worker.connectionStatus],
                        )}
                      </span>
                      {worker.typeName && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span
                            className="max-w-20 shrink-0 truncate rounded bg-muted px-1 text-[9px] text-muted-foreground/70"
                            title={worker.typeId ?? undefined}
                          >
                            {worker.typeName}
                          </span>
                        </>
                      )}
                      <span className="text-muted-foreground/30">·</span>
                      <span className="min-w-0 truncate font-mono">{worker.agentId}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
                      <span className="shrink-0">{t("assistant.workers.model", "Model")}:</span>
                      <span
                        className="min-w-0 truncate font-mono"
                        title={worker.modelId ?? undefined}
                      >
                        {worker.modelId ?? t("assistant.workers.agentDefault", "Agent default")}
                      </span>
                    </span>
                    <span
                      className="min-w-0 max-w-full truncate font-mono text-[10px] text-muted-foreground/50"
                      title={worker.cwd}
                    >
                      {worker.cwd}
                    </span>
                    {(worker.currentTurnId || worker.lastTurnId) && (
                      <span className="min-w-0 truncate text-[10px] text-muted-foreground/60">
                        {t("assistant.workers.turn", "Turn")}{" "}
                        {worker.currentTurnId ?? worker.lastTurnId}
                      </span>
                    )}
                    {worker.lastError && (
                      <span className="min-w-0 whitespace-pre-wrap wrap-break-word text-[10px] text-destructive/80 line-clamp-2">
                        {worker.lastError}
                      </span>
                    )}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </div>
    </div>
  );
}
