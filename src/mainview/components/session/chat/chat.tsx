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
      {/*
        裁切层：仅用于裁掉 ask-user 弹层"下降"后溢出 Chat 底部的部分。
        pointer-events-none 让点击穿透，弹层自身 pointer-events-auto 不受影响。
        注意不能把 overflow-hidden 直接加在弹层卡片上（会裁掉 react-mentions 的 suggestions）。
      */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <AskUserDialog sessionId={session.id} />
      </div>
    </div>
  );
}
