import type { PermissionRequest } from "../store";
import { rpc } from "../rpc";
import { useAppStore } from "../store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

interface Props {
  request: PermissionRequest;
}

export function PermissionDialog({ request }: Props) {
  const removePermissionRequest = useAppStore((s) => s.removePermissionRequest);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const handleSelect = async (optionId: string) => {
    await rpc.respondPermission(request.toolCall.toolCallId, optionId);
    if (activeSessionId) {
      removePermissionRequest(activeSessionId, request.toolCall.toolCallId);
    }
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-yellow-500/10">
              <ShieldAlert className="size-5 text-yellow-400" />
            </div>
            <div>
              <DialogTitle>Permission Required</DialogTitle>
              <DialogDescription>{request.toolCall.title}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
