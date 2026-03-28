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
  private sessionId: string | null = null;
  private onSessionUpdate: SessionUpdateCallback;
  private onPermissionRequest: PermissionRequestCallback;
  private _isConnected = false;
  private _agentInfo: acp.InitializeResponse | null = null;
  private _modelState: acp.SessionModelState | null = null;

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
  get modelState() {
    return this._modelState;
  }
  get currentSessionId() {
    return this.sessionId;
  }

  async connect(): Promise<acp.InitializeResponse> {
    const proc = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "inherit"],
      cwd: this.options.cwd,
    });
    this.process = proc;

    const input = Writable.toWeb(proc.stdin!);
    const output = Readable.toWeb(proc.stdout!);
    const rawStream = acp.ndJsonStream(input, output as any);

    // Wrap stream to log raw JSON-RPC messages
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
        } catch {
          // Process already exited, ignore
        }
      },
      async close() {
        try {
          rawWriter.releaseLock();
        } catch {
          // ignore
        }
      },
    });
    const stream = { readable: logReadable, writable: logWritable };

    const bridge = this;
    const client: acp.Client = {
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        return bridge.onPermissionRequest(params);
      },
      async sessionUpdate(params: SessionNotification): Promise<void> {
        bridge.onSessionUpdate(params);
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
      clientInfo: { name: "Cowork", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
    this._isConnected = true;
    this._agentInfo = initResult;
    console.log("[ACP] agent capabilities:", JSON.stringify(initResult, null, 2));
    return initResult;
  }

  async createSession(): Promise<string> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.newSession({
      cwd: this.options.cwd,
      mcpServers: [],
    });
    this.sessionId = result.sessionId;
    this._modelState = result.models ?? null;
    return result.sessionId;
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.connection || !this.sessionId) throw new Error("No active session");
    await this.connection.unstable_setSessionModel({
      sessionId: this.sessionId,
      modelId,
    });
    if (this._modelState) {
      this._modelState.currentModelId = modelId;
    }
  }

  async resumeSession(sessionId: string): Promise<acp.SessionModelState | null> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.loadSession({
      sessionId,
      cwd: this.options.cwd,
      mcpServers: [],
    });
    this.sessionId = sessionId;
    this._modelState = result.models ?? null;
    return this._modelState;
  }

  async sendPrompt(text: string): Promise<acp.PromptResponse> {
    if (!this.connection || !this.sessionId) throw new Error("No active session");
    return this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  async cancel(): Promise<void> {
    if (!this.connection || !this.sessionId) return;
    await this.connection.cancel({ sessionId: this.sessionId });
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;
    this.sessionId = null;
    this.connection = null;
    if (this.process) {
      const proc = this.process;
      this.process = null;
      proc.kill();
      await new Promise<void>((resolve) => {
        if (proc.exitCode !== null) {
          resolve();
          return;
        }
        proc.on("exit", () => resolve());
        setTimeout(() => {
          proc.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }
}
