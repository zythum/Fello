import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";
import { PermissionDialog } from "./permission-dialog";
import { useActiveSessionState } from "../store";

export function Chat() {
  const { permissionRequests } = useActiveSessionState();
  const currentPermissionRequest = permissionRequests[0];

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-sidebar">
      <ChatArea />
      <ChatInput />
      {currentPermissionRequest && (
        <PermissionDialog
          key={currentPermissionRequest.toolCall.toolCallId}
          request={currentPermissionRequest}
        />
      )}
    </div>
  );
}
