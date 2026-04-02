import type { ElectrobunRPCSchema } from "electrobun/bun";

// Shared RPC schema between bun (main process) and webview (frontend)
export type FelloRPCSchema = ElectrobunRPCSchema & {
  bun: {
    requests: {
      // Webview → Bun calls
      listSessions: { params: void; response: unknown[] };
      newChat: { params: string; response: { sessionId: string; agentInfo: unknown } };
      resumeChat: {
        params: { sessionId: string; cwd: string };
        response: { ok: boolean; models: unknown | null };
      };
      sendMessage: { params: string; response: { stopReason: string } };
      cancelPrompt: { params: void; response: void };
      respondPermission: { params: { toolCallId: string; optionId: string }; response: void };
      updateSessionTitle: { params: { sessionId: string; title: string }; response: void };
      changeWorkDir: {
        params: { sessionId: string };
        response: { ok: boolean; cwd: string | null };
      };
      deleteSession: { params: string; response: void };
      disconnect: { params: void; response: void };
      getCwd: { params: void; response: string };
      pickWorkDir: { params: void; response: string | null };
      getModels: {
        params: void;
        response: {
          availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
          currentModelId: string;
        } | null;
      };
      setModel: { params: string; response: void };
      searchFiles: {
        params: { cwd: string; query?: string };
        response: Array<{ id: string; display: string }>;
      };
      readDir: {
        params: { path: string; depth?: number };
        response: unknown;
      };
      createFile: { params: { path: string; isFolder: boolean }; response: void };
      deleteFile: { params: { path: string; permanent: boolean }; response: void };
      getPlatform: { params: void; response: string };
      renameFile: { params: { oldPath: string; newPath: string }; response: void };
      moveFile: { params: { oldPath: string; newPath: string }; response: void };
      readFile: { params: string; response: string };
      revealInFinder: { params: string; response: void };
      writeDroppedFile: {
        params: { fileName: string; base64: string; destDir: string };
        response: void;
      };
      writeDroppedFolder: {
        params: { destDir: string };
        response: void;
      };
      showContextMenu: {
        params: {
          items: Array<{
            label?: string;
            action?: string;
            type?: string;
            enabled?: boolean;
            data?: unknown;
          }>;
        };
        response: string | null;
      };
    };
    messages: Record<never, never>;
  };
  webview: {
    requests: {
      // Bun → Webview calls
      onSessionUpdate: { params: string; response: { ok: boolean } };
      onPermissionRequest: { params: string; response: { ok: boolean } };
    };
    messages: Record<never, never>;
  };
};
