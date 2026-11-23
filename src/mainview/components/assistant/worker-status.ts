import type { AssistantWorkerInfo } from "../../../shared/schema";

/**
 * Shared status palette for every worker surface (panel item, detail parameters).
 * Keep text and dot colors paired so the same state looks identical everywhere.
 */
export const WORKER_STATUS_TEXT: Record<AssistantWorkerInfo["status"], string> = {
  running: "text-sky-500",
  awaiting_permission: "text-amber-500",
  idle: "text-muted-foreground",
  failed: "text-destructive",
  closed: "text-muted-foreground/60",
  interrupted: "text-amber-500",
};

export const WORKER_STATUS_DOT: Record<AssistantWorkerInfo["status"], string> = {
  running: "bg-sky-500",
  awaiting_permission: "bg-amber-500",
  idle: "bg-muted-foreground/40",
  failed: "bg-destructive",
  closed: "bg-muted-foreground/20",
  interrupted: "bg-amber-500",
};

export const WORKER_STATUS_FALLBACKS: Record<AssistantWorkerInfo["status"], string> = {
  running: "Running",
  awaiting_permission: "Awaiting permission",
  idle: "Idle",
  failed: "Failed",
  closed: "Closed",
  interrupted: "Interrupted",
};

export const WORKER_CONNECTION_DOT: Record<
  AssistantWorkerInfo["connectionStatus"],
  string
> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500",
  disconnected: "bg-muted-foreground/30",
};

export const WORKER_CONNECTION_TEXT: Record<
  AssistantWorkerInfo["connectionStatus"],
  string
> = {
  connected: "text-emerald-600 dark:text-emerald-400",
  connecting: "text-amber-600 dark:text-amber-400",
  disconnected: "text-muted-foreground/70",
};

export const WORKER_CONNECTION_FALLBACKS: Record<
  AssistantWorkerInfo["connectionStatus"],
  string
> = {
  connected: "Connected",
  connecting: "Connecting",
  disconnected: "Disconnected",
};
