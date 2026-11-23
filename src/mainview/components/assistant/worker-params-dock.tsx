import { useTranslation } from "react-i18next";
import { Award, CpuAi, FolderOpen } from "lucide-react";
import type { AssistantWorkerInfo } from "../../../shared/schema";
import { electron } from "../../electron";
import {
  WORKER_CONNECTION_DOT,
  WORKER_CONNECTION_FALLBACKS,
  WORKER_CONNECTION_TEXT,
  WORKER_STATUS_DOT,
  WORKER_STATUS_FALLBACKS,
  WORKER_STATUS_TEXT,
} from "./worker-status";
import { cn } from "@/lib/utils";

/** Read-only worker parameters, docked where a chat input would normally sit. */
export function WorkerParamsDock({ worker }: { worker: AssistantWorkerInfo }) {
  const { t } = useTranslation();
  const turnId = worker.currentTurnId ?? worker.lastTurnId;
  const typeLabel = worker.typeName ?? worker.typeId ?? "—";
  const modelLabel = worker.modelId ?? t("assistant.workers.agentDefault", "Agent default");
  const connectionLabel = t(
    `assistant.workers.connection.${worker.connectionStatus}`,
    WORKER_CONNECTION_FALLBACKS[worker.connectionStatus],
  );
  const statusLabel = t(
    `assistant.workers.status.${worker.status}`,
    WORKER_STATUS_FALLBACKS[worker.status],
  );

  return (
    <div className="relative -mt-6 shrink-0 p-6">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-input bg-card shadow-[0_0_20px] shadow-primary/10 dark:shadow-primary/20">
        <div className="flex min-w-0 items-center gap-3 border-b border-border/60 p-2">
          <span
            className="min-w-0 truncate text-xs font-medium text-foreground/85"
            title={worker.name || worker.id}
          >
            {worker.name || worker.id}
          </span>
          <button
            type="button"
            className="group/worker-id flex shrink-0 items-center gap-0.5 rounded-sm font-mono text-[10px] whitespace-nowrap text-muted-foreground/70 hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
            title={`${t("assistant.workers.openDataDir", "Open worker folder")}: ${worker.dataDir}`}
            onClick={() => void electron.revealInFinder(worker.dataDir).catch(() => {})}
          >
            <span>{worker.id}</span>
            <FolderOpen className="size-3 shrink-0 text-muted-foreground/50 transition-colors group-hover/worker-id:text-foreground/70" />
          </button>
          <span
            className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/70"
            title={turnId ?? undefined}
          >
            {t("assistant.workers.detail.turnSummary", "Turn {{count}}", {
              count: worker.turnCount ?? 0,
            })}
          </span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(112px,auto)] divide-x divide-border/60">
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

        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-1 border-t border-border/60 p-2 text-left font-mono text-[10px] text-muted-foreground hover:bg-muted/40 hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
          title={`${t("assistant.workers.revealWorkspace", "Reveal in Finder")}: ${worker.cwd}`}
          onClick={() => void electron.revealInFinder(worker.cwd).catch(() => {})}
        >
          <FolderOpen className="size-3 shrink-0 text-muted-foreground/50" />
          <span className="min-w-0 truncate">{worker.cwd}</span>
        </button>

        {worker.lastError && (
          <div
            className="border-t border-border/60 p-2 text-[10px] text-destructive/80 line-clamp-2 whitespace-pre-wrap wrap-break-word"
            title={worker.lastError}
          >
            {worker.lastError}
          </div>
        )}
      </div>
    </div>
  );
}
