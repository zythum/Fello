import { Electroview } from "electrobun/view";
import type { CoworkRPCSchema } from "../bun/rpc-schema";

// Define handlers for bun → webview calls, get back typed rpc instance
const rpcInstance = Electroview.defineRPC<CoworkRPCSchema>({
  maxRequestTime: Infinity,
  handlers: {
    requests: {
      async onSessionUpdate(jsonStr: unknown) {
        window.dispatchEvent(
          new CustomEvent("acp:session-update", { detail: JSON.parse(jsonStr as string) }),
        );
        return { ok: true };
      },
      async onPermissionRequest(jsonStr: unknown) {
        window.dispatchEvent(
          new CustomEvent("acp:permission-request", { detail: JSON.parse(jsonStr as string) }),
        );
        return { ok: true };
      },
    },
  },
});

// Wire up the Electroview transport
new Electroview({ rpc: rpcInstance });

// Typed helpers for webview → bun calls
export const rpc = {
  listSessions: () => rpcInstance.request.listSessions(),
  getEvents: (sessionId: string) => rpcInstance.request.getEvents(sessionId),
  newChat: (cwd: string) => rpcInstance.request.newChat(cwd),
  resumeChat: (sessionId: string, cwd: string) =>
    rpcInstance.request.resumeChat({ sessionId, cwd }),
  sendMessage: (text: string) => rpcInstance.request.sendMessage(text),
  cancelPrompt: () => rpcInstance.request.cancelPrompt(),
  respondPermission: (toolCallId: string, optionId: string) =>
    rpcInstance.request.respondPermission({ toolCallId, optionId }),
  saveEvent: (sessionId: string, event: unknown) =>
    rpcInstance.request.saveEvent({ sessionId, event }),
  updateSessionTitle: (sessionId: string, title: string) =>
    rpcInstance.request.updateSessionTitle({ sessionId, title }),
  deleteSession: (sessionId: string) => rpcInstance.request.deleteSession(sessionId),
  disconnect: () => rpcInstance.request.disconnect(),
  getCwd: () => rpcInstance.request.getCwd(),
  pickWorkDir: () => rpcInstance.request.pickWorkDir(),
  getModels: () => rpcInstance.request.getModels(),
  setModel: (modelId: string) => rpcInstance.request.setModel(modelId),
  readDir: (path: string, depth?: number) => rpcInstance.request.readDir({ path, depth }),
  createFile: (path: string, isFolder: boolean) =>
    rpcInstance.request.createFile({ path, isFolder }),
  deleteFile: (path: string) => rpcInstance.request.deleteFile(path),
  renameFile: (oldPath: string, newPath: string) =>
    rpcInstance.request.renameFile({ oldPath, newPath }),
  moveFile: (oldPath: string, newPath: string) =>
    rpcInstance.request.moveFile({ oldPath, newPath }),
  readFile: (path: string) => rpcInstance.request.readFile(path),
};
