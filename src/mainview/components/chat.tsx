import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";

export function Chat() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <ChatArea />
      <ChatInput />
    </div>
  );
}
