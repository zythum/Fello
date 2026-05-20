import { ChatHeader } from "./chat-header";
import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";
import { AskUserDialog } from "./chat-ask-user-dialog";
import type { SessionInfo } from "../../../../shared/schema";

export function Chat({ session }: { session: SessionInfo }) {
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <ChatHeader session={session} />
      <ChatArea session={session} />
      <ChatInput session={session} />
      <AskUserDialog sessionId={session.id} />
    </div>
  );
}
