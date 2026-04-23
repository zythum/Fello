import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";
import type { SessionInfo } from "../../../../shared/schema";
export function Chat({ session }: { session: SessionInfo }) {
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <ChatArea session={session} />
      <ChatInput session={session} />
    </div>
  );
}
