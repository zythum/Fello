import { useAppStore, type PermissionRequest, type AppState } from "../../store";
import type { SessionInfo } from "../../../shared/schema";
import * as backend from "../../backend";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface Props {
  request: PermissionRequest;
  sessionId: string;
  toastId: string | number;
}

export function PermissionDialog({ request, sessionId, toastId: _toastId }: Props) {
  const { t } = useTranslation();
  const session = useAppStore((s: AppState) =>
    s.sessions.find((x: SessionInfo) => x.id === sessionId),
  );
  const sessionTitle = session?.title || t("sidebar.newChat", "New Chat");

  const handleSelect = async (optionId: string) => {
    try {
      await backend.request.respondPermission({
        toolCallId: request.toolCall.toolCallId,
        optionId,
      });
    } catch {
      toast.error(t("permission.error", "Failed to respond to permission request"));
    }
  };

  return (
    <div className="flex w-(--width) flex-col gap-4 rounded-xl border bg-popover p-5 text-sm text-popover-foreground shadow-lg overflow-hidden">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/10">
            <ShieldAlert className="size-5 text-yellow-400" />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <h2 className="leading-none font-medium">
              {t("permission.title", "Permission Required")}
            </h2>
            <p className="text-xs text-muted-foreground truncate" title={sessionTitle}>
              {sessionTitle}
            </p>
          </div>
        </div>
        <pre className="text-xs text-foreground/80 bg-muted mt-1 p-2 rounded wrap-anywhere whitespace-pre-wrap break-all">
          {request.toolCall.title}
        </pre>
      </div>
      <div className="flex flex-col gap-2">
        {request.options.map((option: any) => {
          const isAllow = option.kind === "allow_once" || option.kind === "allow_always";
          return (
            <Button
              key={option.optionId}
              variant={isAllow ? "outline" : "destructive"}
              className="justify-start h-8 px-3"
              onClick={() => handleSelect(option.optionId)}
            >
              {option.name}
              <span className="ml-auto text-[10px] opacity-60">({option.kind})</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
