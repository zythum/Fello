import { spawn, type ChildProcess } from "child_process";
import { Writable, Readable } from "stream";
import * as acp from "@agentclientprotocol/sdk";
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
} from "@agentclientprotocol/sdk";

export type SessionUpdateCallback = (update: SessionNotification) => void;
export type PermissionRequestCallback = (
  params: RequestPermissionRequest,
) => Promise<RequestPermissionResponse>;

export interface ACPBridgeOptions {
  command: string;
  args: string[];
  cwd: string;
  onSessionUpdate: SessionUpdateCallback;
  onPermissionRequest: PermissionRequestCallback;
}

export class ACPBridge {
  private process: ChildProcess | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private onSessionUpdate: SessionUpdateCallback;
  private onPermissionRequest: PermissionRequestCallback;
  private _isConnected = false;
  private _agentInfo: acp.InitializeResponse | null = null;
  private _modelStates = new Map<string, acp.SessionModelState>();

  constructor(private options: ACPBridgeOptions) {
    this.onSessionUpdate = options.onSessionUpdate;
    this.onPermissionRequest = options.onPermissionRequest;
  }

  get isConnected() {
    return this._isConnected;
  }

  get agentInfo() {
    return this._agentInfo;
  }

  getModelState(sessionId: string): acp.SessionModelState | null {
    return this._modelStates.get(sessionId) ?? null;
  }

  async connect(): Promise<acp.InitializeResponse> {
    const proc = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "inherit"],
      cwd: this.options.cwd,
      detached: true,
    });
    proc.unref();
    this.process = proc;

    const input = Writable.toWeb(proc.stdin!);
    const output = Readable.toWeb(proc.stdout!);
    const rawStream = acp.ndJsonStream(input, output as any);

    const logReadable = rawStream.readable.pipeThrough(
      new TransformStream({
        transform(msg, controller) {
          console.log("[ACP ←]", JSON.stringify(msg));
          controller.enqueue(msg);
        },
      }),
    );
    const rawWriter = rawStream.writable.getWriter();
    const logWritable = new WritableStream({
      async write(msg) {
        console.log("[ACP →]", JSON.stringify(msg));
        try {
          await rawWriter.write(msg);
        } catch {}
      },
      async close() {
        try {
          rawWriter.releaseLock();
        } catch {}
      },
    });
    const stream = { readable: logReadable, writable: logWritable };

    const onPermission = this.onPermissionRequest;
    const onUpdate = this.onSessionUpdate;
    const client: acp.Client = {
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        return onPermission(params);
      },
      async sessionUpdate(params: SessionNotification): Promise<void> {
        onUpdate(params);
      },
      async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
        const { writeFile } = await import("fs/promises");
        await writeFile(params.path, "");
        return {};
      },
      async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
        const { readFile } = await import("fs/promises");
        const content = await readFile(params.path, "utf-8");
        return { content };
      },
      async extNotification(_method: string, _params: unknown): Promise<void> {},
    };

    this.connection = new acp.ClientSideConnection((_agent) => client, stream);
    const initResult = await this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: { name: "Fello", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
    this._isConnected = true;
    this._agentInfo = initResult;
    console.log("[ACP] agent capabilities:", JSON.stringify(initResult, null, 2));
    return initResult;
  }

  async newSession(
    cwd: string,
  ): Promise<{ sessionId: string; models: acp.SessionModelState | null }> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.newSession({
      cwd,
      mcpServers: [],
    });
    const models = result.models ?? null;
    if (models) this._modelStates.set(result.sessionId, models);
    return { sessionId: result.sessionId, models };
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    if (!this.connection) throw new Error("Not connected");
    await this.connection.unstable_setSessionModel({ sessionId, modelId });
    const state = this._modelStates.get(sessionId);
    if (state) {
      state.currentModelId = modelId;
    }
  }

  async loadSession(sessionId: string, cwd: string): Promise<acp.SessionModelState | null> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.loadSession({
      sessionId,
      cwd,
      mcpServers: [],
    });
    const models = result.models ?? null;
    if (models) this._modelStates.set(sessionId, models);
    return models;
  }

  async sendPrompt(sessionId: string, text: string): Promise<acp.PromptResponse> {
    if (!this.connection) throw new Error("Not connected");
    return this.connection.prompt({
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  async cancel(sessionId: string): Promise<void> {
    if (!this.connection) return;
    await this.connection.cancel({ sessionId });
  }

  async disconnect(): Promise<void> {
    if (this.connection && this._isConnected) {
      const sessionIds = [...this._modelStates.keys()];
      for (const sid of sessionIds) {
        try {
          await this.connection.unstable_closeSession({ sessionId: sid });
        } catch {}
      }
    }

    this._isConnected = false;
    this._modelStates.clear();
    this.connection = null;

    if (this.process) {
      const proc = this.process;
      this.process = null;
      try {
        proc.stdin?.end();
      } catch {}
      await new Promise<void>((resolve) => {
        if (proc.exitCode !== null) {
          resolve();
          return;
        }
        proc.on("exit", () => resolve());
        setTimeout(() => {
          this.killProcessGroup(proc, "SIGTERM");
          setTimeout(() => {
            this.killProcessGroup(proc, "SIGKILL");
            resolve();
          }, 2000);
        }, 3000);
      });
    }
  }

  killSync(): void {
    this._isConnected = false;
    this._modelStates.clear();
    this.connection = null;
    if (this.process) {
      const proc = this.process;
      this.process = null;
      try {
        proc.stdin?.end();
      } catch {}
      this.killProcessGroup(proc, "SIGTERM");
    }
  }

  private killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
    const pid = proc.pid;
    if (pid == null) return;
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {}
    }
  }
}
