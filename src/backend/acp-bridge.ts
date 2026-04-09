import { spawn, type ChildProcess } from "child_process";
import { Writable, Readable } from "stream";
import {
  ndJsonStream,
  Client,
  ClientSideConnection,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
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
  InitializeResponse,
  SessionModelState,
  SessionModeState,
  NewSessionRequest,
  NewSessionResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  PromptRequest,
  PromptResponse,
  CancelNotification,
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

/**
 * ACPBridge
 * 该类是对 Agent Client Protocol (ACP) SDK 及其底层子进程的纯粹封装。
 *
 * ⚠️ 关键警告：
 * 在 ACPBridge 的所有 API（如 newSession、loadSession、sendPrompt 等）中，
 * 它们所接收或返回的 `sessionId` 参数，在业务语义上均对应于
 * `src/shared/schema.ts` 中定义的 `SessionInfo.resumeId`。
 *
 * 绝对不要混淆传入 Fello 自身的 `SessionInfo.id`，否则会导致底层 Agent 无法识别会话。
 */
export class ACPBridge {
  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private onSessionUpdate: SessionUpdateCallback;
  private onPermissionRequest: PermissionRequestCallback;
  private _isConnected = false;
  private _agentInfo: InitializeResponse | null = null;
  private _modelStates = new Map<string, SessionModelState>();
  private _modeStates = new Map<string, SessionModeState>();
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

  /**
   * ⚠️ 获取指定会话的模型状态
   * @param sessionId ACP 侧的会话标识（即 Fello 业务中的 SessionInfo.resumeId）
   */
  getModelState(sessionId: string): SessionModelState | null {
    return this._modelStates.get(sessionId) ?? null;
  }

  /**
   * ⚠️ 获取指定会话的模式状态
   * @param sessionId ACP 侧的会话标识（即 Fello 业务中的 SessionInfo.resumeId）
   */
  getModeState(sessionId: string): SessionModeState | null {
    return this._modeStates.get(sessionId) ?? null;
  }

  async connect(): Promise<InitializeResponse> {
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
    const rawStream = ndJsonStream(input, output as ReadableStream<Uint8Array>);

    let stream: { readable: ReadableStream; writable: WritableStream };

    if (process.env.NODE_ENV === "development") {
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
      stream = { readable: logReadable, writable: logWritable };
    } else {
      stream = rawStream;
    }

    const onPermission = this.onPermissionRequest;
    const onUpdate = this.onSessionUpdate;
    const modeStates = this._modeStates;
    const terminalManager = this.terminalManager;
    const defaultCwd = this.options.cwd;
    const client: Client = {
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
        const term = terminalManager.getTerminal(params.terminalId);
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

    this.connection = new ClientSideConnection((_agent) => client, stream);
    const initResult = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "Fello", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    this._isConnected = true;
    this._agentInfo = initResult;
    return initResult;
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.newSession(params);
    const models = result.models ?? null;
    const modes = result.modes ?? null;
    if (models) this._modelStates.set(result.sessionId, models);
    if (modes) this._modeStates.set(result.sessionId, modes);
    return result;
  }

  async setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.unstable_setSessionModel(params);
    const state = this._modelStates.get(params.sessionId);
    if (state) {
      state.currentModelId = params.modelId;
    }
    return result;
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.loadSession(params);
    const models = result.models ?? null;
    const modes = result.modes ?? null;
    if (models) this._modelStates.set(params.sessionId, models);
    if (modes) this._modeStates.set(params.sessionId, modes);
    return result;
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.setSessionMode(params);
    const state = this._modeStates.get(params.sessionId);
    if (state) {
      state.currentModeId = params.modeId;
    }
    return result;
  }

  async sendPrompt(params: PromptRequest): Promise<PromptResponse> {
    if (!this.connection) throw new Error("Not connected");
    return this.connection.prompt(params);
  }

  async cancel(params: CancelNotification): Promise<void> {
    if (!this.connection) return;
    await this.connection.cancel(params);
  }

  async kill(): Promise<void> {
    if (this.connection && this._isConnected) {
      const sessionIds = new Set([...this._modelStates.keys(), ...this._modeStates.keys()]);
      for (const sid of sessionIds) {
        try {
          await this.connection.unstable_closeSession({ sessionId: sid }).catch(() => {});
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
        const onExit = () => {
          clearTimeout(termTimer);
          if (killTimer) {
            clearTimeout(killTimer);
          }
          resolve();
        };
        let killTimer: NodeJS.Timeout | null = null;
        proc.once("exit", onExit);
        const termTimer = setTimeout(() => {
          this.killProcessGroup(proc, "SIGTERM");
          killTimer = setTimeout(() => {
            this.killProcessGroup(proc, "SIGKILL");
            proc.removeListener("exit", onExit);
            resolve();
          }, 2000);
        }, 3000);
      });
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
