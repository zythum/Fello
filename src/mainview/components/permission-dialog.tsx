import type { PermissionRequest } from "../store";
import * as backend from "../backend";
import { useAppStore } from "../store";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

interface Props {
  request: PermissionRequest;
}

export function PermissionDialog({ request }: Props) {
  const { t } = useTranslation();
  const removePermissionRequest = useAppStore((s) => s.removePermissionRequest);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const handleSelect = async (optionId: string) => {
    await backend.request.respondPermission({ toolCallId: request.toolCall.toolCallId, optionId });
    if (activeSessionId) {
      removePermissionRequest(activeSessionId, request.toolCall.toolCallId);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="grid w-full max-w-[calc(100%-2rem)] m-4 gap-6 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 sm:max-w-md">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-yellow-500/10">
            <ShieldAlert className="size-5 text-yellow-400" />
          </div>
          <div>
            <h2 className="leading-none font-normal">
              {t("permission.title", "Permission Required")}
            </h2>
            <p className="text-sm text-muted-foreground">{request.toolCall.title}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {request.options.map((option) => {
            const isAllow = option.kind === "allow_once" || option.kind === "allow_always";
            return (
              <Button
                key={option.optionId}
                variant={isAllow ? "outline" : "destructive"}
                className="justify-start"
                onClick={() => handleSelect(option.optionId)}
              >
                {option.name}
                <span className="ml-auto text-xs opacity-60">({option.kind})</span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
