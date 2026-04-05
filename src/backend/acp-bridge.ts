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
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
} from "@agentclientprotocol/sdk";
import { AgentTerminalManager } from "./agent-terminal-manager";

export type SessionUpdateCallback = (update: SessionNotification) => void;
export type PermissionRequestCallback = (
  params: RequestPermissionRequest,
) => Promise<RequestPermissionResponse>;
export type AgentTerminalOutputCallback = (terminalId: string, data: string) => void;

export interface ACPBridgeOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  onSessionUpdate: SessionUpdateCallback;
  onPermissionRequest: PermissionRequestCallback;
  onAgentTerminalOutput: AgentTerminalOutputCallback;
}

export class ACPBridge {
  private process: ChildProcess | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private onSessionUpdate: SessionUpdateCallback;
  private onPermissionRequest: PermissionRequestCallback;
  private _isConnected = false;
  private _agentInfo: acp.InitializeResponse | null = null;
  private _modelStates = new Map<string, acp.SessionModelState>();
  private _modeStates = new Map<string, acp.SessionModeState>();
  public terminalManager: AgentTerminalManager;

  constructor(private options: ACPBridgeOptions) {
    this.onSessionUpdate = options.onSessionUpdate;
    this.onPermissionRequest = options.onPermissionRequest;
    this.terminalManager = new AgentTerminalManager(options.onAgentTerminalOutput);
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

  getModeState(sessionId: string): acp.SessionModeState | null {
    return this._modeStates.get(sessionId) ?? null;
  }

  async connect(): Promise<acp.InitializeResponse> {
    const proc = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "inherit"],
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
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
    const modeStates = this._modeStates;
    const terminalManager = this.terminalManager;
    const defaultCwd = this.options.cwd;
    const client: acp.Client = {
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        return onPermission(params);
      },
      async sessionUpdate(params: SessionNotification): Promise<void> {
        if (params.update?.sessionUpdate === "current_mode_update") {
          const existing = modeStates.get(params.sessionId);
          if (existing) {
            existing.currentModeId = params.update.currentModeId;
          }
        }
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
      async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
        const id = terminalManager.create(
          params.command,
          params.args || [],
          params.cwd || defaultCwd,
          params.env?.reduce((acc, envVar) => ({ ...acc, [envVar.name]: envVar.value }), {}) || {},
          params.outputByteLimit || 1048576,
        );
        return { terminalId: id };
      },
      async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
        const { output, truncated } = terminalManager.getOutput(params.terminalId);
        // SDK doesn't define exitStatus if it hasn't exited, so we shouldn't add it unless finished
        // We'll leave it out for now as AgentTerminalManager doesn't return exitStatus in getOutput yet
        // Wait, let's fix getOutput in AgentTerminalManager to return exitStatus if finished.
        const term = (terminalManager as any).terminals.get(params.terminalId);
        return {
          output,
          truncated,
          ...(term?.isFinished
            ? { exitStatus: { exitCode: term.exitCode, signal: term.signal } }
            : {}),
        };
      },
      async waitForTerminalExit(
        params: WaitForTerminalExitRequest,
      ): Promise<WaitForTerminalExitResponse> {
        const { exitCode, signal } = await terminalManager.waitForExit(params.terminalId);
        return { exitCode: exitCode ?? undefined, signal: signal ?? undefined };
      },
      async killTerminal(params: KillTerminalRequest): Promise<KillTerminalResponse> {
        terminalManager.kill(params.terminalId);
        return {};
      },
      async releaseTerminal(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
        terminalManager.release(params.terminalId);
        return {};
      },
      async extNotification(_method: string, _params: unknown): Promise<void> {},
    };

    this.connection = new acp.ClientSideConnection((_agent) => client, stream);
    const initResult = await this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: { name: "Fello", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    this._isConnected = true;
    this._agentInfo = initResult;
    console.log("[ACP] agent capabilities:", JSON.stringify(initResult, null, 2));
    return initResult;
  }

  async newSession(cwd: string): Promise<{
    sessionId: string;
    models: acp.SessionModelState | null;
    modes: acp.SessionModeState | null;
  }> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.newSession({
      cwd,
      mcpServers: [],
    });
    const models = result.models ?? null;
    const modes = result.modes ?? null;
    if (models) this._modelStates.set(result.sessionId, models);
    if (modes) this._modeStates.set(result.sessionId, modes);
    return { sessionId: result.sessionId, models, modes };
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    if (!this.connection) throw new Error("Not connected");
    await this.connection.unstable_setSessionModel({ sessionId, modelId });
    const state = this._modelStates.get(sessionId);
    if (state) {
      state.currentModelId = modelId;
    }
  }

  async loadSession(
    sessionId: string,
    cwd: string,
  ): Promise<{ models: acp.SessionModelState | null; modes: acp.SessionModeState | null }> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.loadSession({
      sessionId,
      cwd,
      mcpServers: [],
    });
    const models = result.models ?? null;
    const modes = result.modes ?? null;
    if (models) this._modelStates.set(sessionId, models);
    if (modes) this._modeStates.set(sessionId, modes);
    return { models, modes };
  }

  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    if (!this.connection) throw new Error("Not connected");
    await this.connection.setSessionMode({ sessionId, modeId });
    const state = this._modeStates.get(sessionId);
    if (state) {
      state.currentModeId = modeId;
    }
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
      const sessionIds = new Set([...this._modelStates.keys(), ...this._modeStates.keys()]);
      for (const sid of sessionIds) {
        try {
          await this.connection.unstable_closeSession({ sessionId: sid });
        } catch {}
      }
    }

    this._isConnected = false;
    this._modelStates.clear();
    this._modeStates.clear();
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
    this._modeStates.clear();
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
