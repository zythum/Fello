import { writeFile, readFile } from "fs/promises";
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
  NewSessionRequest,
  NewSessionResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  PromptRequest,
  PromptResponse,
  CancelNotification,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { AgentInfo, SessionModelState, SessionModeState } from "../../shared/schema";
import { type AgentProcess } from "./base-agent";
import { spawnStdioAgent } from "./stdio-agent";
import { spawnOpenaiCompatibleApiAgent } from "./openai-compatible-api-agent";
import { AgentTerminalManager } from "./agent-terminal-manager";

// Set to true to enable ACP message logging
const ACP_VERBOSE_LOG = false;

export interface SetSessionModelRequest {
  sessionId: string;
  modelId: string;
}
export type SetSessionModelResponse = Record<string, never>;

export type SessionConnection = {
  sessionId: string;
};

export type SessionConnectCallback = (connection: SessionConnection) => void;
export type SessionUpdateCallback = (update: SessionNotification) => void;
export type SessionExtNotificationCallback = (method: string, params: unknown) => void;
export type PermissionRequestCallback = (
  params: RequestPermissionRequest,
) => Promise<RequestPermissionResponse>;
export type AgentTerminalOutputCallback = (
  sessionId: string,
  terminalId: string,
  data: string,
) => void;

export interface ACPBridgeOptions {
  agentInfo: AgentInfo;
  cwd: string;
  onSessionConnect: SessionConnectCallback;
  onSessionUpdate: SessionUpdateCallback;
  onExtNotification: SessionExtNotificationCallback;
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
  private process: AgentProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private onSessionConnect: SessionConnectCallback;
  private onSessionUpdate: SessionUpdateCallback;
  private onExtNotification: SessionExtNotificationCallback;
  private onPermissionRequest: PermissionRequestCallback;
  private _isConnected = false;
  private _initializeInfo: InitializeResponse | null = null;
  private _modelStates = new Map<string, SessionModelState>();
  private _modeStates = new Map<string, SessionModeState>();
  private _loadedSessions = new Set<string>();
  private _sessionsCwdMap = new Map<string, string>();
  private _configOptions = new Map<string, SessionConfigOption[]>();

  public terminalManager: AgentTerminalManager;

  constructor(
    public id: string,
    private options: ACPBridgeOptions,
  ) {
    this.onSessionConnect = options.onSessionConnect;
    this.onSessionUpdate = options.onSessionUpdate;
    this.onExtNotification = options.onExtNotification;
    this.onPermissionRequest = options.onPermissionRequest;
    this.terminalManager = new AgentTerminalManager(options.onAgentTerminalOutput);
  }

  get isConnected() {
    return this._isConnected;
  }

  get initializeInfo() {
    return this._initializeInfo;
  }

  isSessionLoaded(sessionId: string): boolean {
    return this._loadedSessions.has(sessionId);
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

  private normalizeSelectOptions(
    options:
      | Array<{ value: string; name: string; description?: string | undefined | null }>
      | Array<{
          options: Array<{ value: string; name: string; description?: string | undefined | null }>;
        }>,
  ): Array<{ value: string; name: string; description?: string | undefined | null }> {
    if (!Array.isArray(options) || options.length === 0) return [];
    const first = options[0] as { value?: unknown; options?: unknown };
    if (typeof first?.value === "string") {
      return (
        options as Array<{ value: string; name: string; description?: string | undefined | null }>
      ).map((item) => ({
        value: item.value,
        name: item.name,
        description: item.description,
      }));
    }
    return (
      options as Array<{
        options: Array<{ value: string; name: string; description?: string | undefined | null }>;
      }>
    ).flatMap((group) =>
      group.options.map((item) => ({
        value: item.value,
        name: item.name,
        description: item.description,
      })),
    );
  }

  private applyConfigOptions(
    sessionId: string,
    configOptions: SessionConfigOption[] | null | undefined,
  ): void {
    if (!configOptions) return;
    this._configOptions.set(sessionId, configOptions);

    const modelOption = configOptions.find(
      (option) => option.type === "select" && option.category === "model",
    );
    if (modelOption) {
      const selectOption = modelOption as Extract<SessionConfigOption, { type: "select" }>;
      const availableModels = this.normalizeSelectOptions(selectOption.options).map((item) => ({
        modelId: item.value,
        name: item.name,
        description: item.description,
      }));
      this._modelStates.set(sessionId, {
        currentModelId: selectOption.currentValue,
        availableModels,
      });
    }

    const modeOption = configOptions.find(
      (option) => option.type === "select" && option.category === "mode",
    );
    if (modeOption) {
      const selectOption = modeOption as Extract<SessionConfigOption, { type: "select" }>;
      const availableModes = this.normalizeSelectOptions(selectOption.options).map((item) => ({
        id: item.value,
        name: item.name,
        description: item.description,
      }));
      this._modeStates.set(sessionId, {
        currentModeId: selectOption.currentValue,
        availableModes,
      });
    }
  }

  private getConfigOptionId(sessionId: string, category: "model" | "mode"): string | null {
    const options = this._configOptions.get(sessionId);
    if (!options) return null;
    const found = options.find(
      (option) => option.category === category && option.type === "select",
    );
    return found?.id ?? null;
  }

  async connect(): Promise<InitializeResponse> {
    const acpId = this.id;
    const proc =
      this.options.agentInfo.type === "stdio"
        ? spawnStdioAgent({ ...this.options.agentInfo, cwd: this.options.cwd })
        : this.options.agentInfo.provider === "openai-compatible"
          ? spawnOpenaiCompatibleApiAgent(this.options.agentInfo)
          : (() => {
              throw new Error(`Unsupported api provider: ${this.options.agentInfo.provider}`);
            })();
    this.process = proc;

    const rawStream = ndJsonStream(proc.input, proc.output);
    let stream: { readable: ReadableStream; writable: WritableStream };

    if (ACP_VERBOSE_LOG && process.env.NODE_ENV === "development") {
      const logReadable = rawStream.readable.pipeThrough(
        new TransformStream({
          transform(msg, controller) {
            console.log(`[ACP:${acpId} ←]`, JSON.stringify(msg));
            controller.enqueue(msg);
          },
        }),
      );
      const rawWriter = rawStream.writable.getWriter();
      const logWritable = new WritableStream({
        async write(msg) {
          console.log(`[ACP:${acpId} →]`, JSON.stringify(msg));
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
    const onExtNotification = this.onExtNotification;
    const applyConfigOptions = this.applyConfigOptions.bind(this);
    const terminalManager = this.terminalManager;
    const sessionsCwdMap = this._sessionsCwdMap;
    const client: Client = {
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        return onPermission(params);
      },
      async sessionUpdate(params: SessionNotification): Promise<void> {
        if (params.update.sessionUpdate === "config_option_update") {
          applyConfigOptions(params.sessionId, params.update.configOptions);
        }
        onUpdate(params);
      },
      async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
        await writeFile(params.path, params.content, "utf8");
        return {};
      },
      async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
        const content = await readFile(params.path, "utf8");
        return { content };
      },
      async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
        const id = terminalManager.create(
          params.sessionId,
          params.command,
          params.args || [],
          params.cwd || sessionsCwdMap.get(params.sessionId) || process.cwd(),
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
      async extNotification(method: string, params: unknown): Promise<void> {
        if (ACP_VERBOSE_LOG && process.env.NODE_ENV === "development") {
          console.log(`[ACP Ext Notification] Method: ${method}`);
        }
        onExtNotification(method, params);
      },
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
    this._initializeInfo = initResult;
    return initResult;
  }

  parseSessionConfigOptions(configOptions: SessionConfigOption[]): {
    models: SessionModelState | null;
    modes: SessionModeState | null;
  } {
    let models: SessionModelState | null = null;
    let modes: SessionModeState | null = null;

    const modelOption = configOptions.find(
      (option) => option.type === "select" && option.category === "model",
    );
    if (modelOption) {
      const selectOption = modelOption as Extract<SessionConfigOption, { type: "select" }>;
      models = {
        currentModelId: selectOption.currentValue,
        availableModels: this.normalizeSelectOptions(selectOption.options).map((item) => ({
          modelId: item.value,
          name: item.name,
          description: item.description,
        })),
      };
    }

    const modeOption = configOptions.find(
      (option) => option.type === "select" && option.category === "mode",
    );
    if (modeOption) {
      const selectOption = modeOption as Extract<SessionConfigOption, { type: "select" }>;
      modes = {
        currentModeId: selectOption.currentValue,
        availableModes: this.normalizeSelectOptions(selectOption.options).map((item) => ({
          id: item.value,
          name: item.name,
          description: item.description,
        })),
      };
    }

    return { models, modes };
  }

  async newSession(
    params: NewSessionRequest,
  ): Promise<NewSessionResponse & { models: SessionModelState | null }> {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.newSession(params);
    const { models: configModels, modes: configModes } = result.configOptions
      ? this.parseSessionConfigOptions(result.configOptions)
      : { models: null, modes: null };
    const models =
      configModels ?? (result as unknown as { models: SessionModelState | null }).models ?? null;
    const modes = configModes ?? result.modes ?? null;
    if (models) this._modelStates.set(result.sessionId, models);
    if (modes) this._modeStates.set(result.sessionId, modes);
    this.applyConfigOptions(result.sessionId, result.configOptions);
    this._loadedSessions.add(result.sessionId);
    this._sessionsCwdMap.set(result.sessionId, params.cwd);
    this.onSessionConnect({ sessionId: result.sessionId });
    return Object.assign(result, { models, modes });
  }

  async hack_setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    return (
      this.connection as unknown as {
        connection: { sendRequest: (method: string, params: any) => Promise<any> };
      }
    ).connection.sendRequest("session/set_model", params);
  }

  async setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    if (!this.connection) throw new Error("Not connected");
    let result: SetSessionModelResponse;
    const configId = this.getConfigOptionId(params.sessionId, "model");
    if (configId) {
      try {
        const cfg = await this.connection.setSessionConfigOption({
          sessionId: params.sessionId,
          configId,
          value: params.modelId,
        });
        this.applyConfigOptions(params.sessionId, cfg.configOptions);
        result = {};
      } catch {
        // Fallback to raw session/set_model for agents like kiro-cli that don't support set_config_option
        result = await this.hack_setSessionModel(params);
      }
    } else {
      // No configOptions available, use raw session/set_model (kiro-cli style)
      result = await this.hack_setSessionModel(params);
    }
    const state = this._modelStates.get(params.sessionId);
    if (state) {
      state.currentModelId = params.modelId;
    }
    return result;
  }

  /**
   * Close a session in the agent and clean up bridge cache.
   */
  async closeSession(sessionId: string): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.closeSession({ sessionId }).catch(() => {});
      } catch {}
    }
    this._modelStates.delete(sessionId);
    this._modeStates.delete(sessionId);
    this._configOptions.delete(sessionId);
    this._loadedSessions.delete(sessionId);
    this._sessionsCwdMap.delete(sessionId);
  }

  /**
   * Delete a session's persisted data via the ACP session/delete protocol.
   * The agent will remove the session directory (~/.fello/api-agents/...).
   * Deleted/non-existent sessions are handled gracefully.
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.connection) return;
    try {
      await this.connection.deleteSession({ sessionId });
    } catch {}
    this._modelStates.delete(sessionId);
    this._modeStates.delete(sessionId);
    this._configOptions.delete(sessionId);
    this._loadedSessions.delete(sessionId);
    this._sessionsCwdMap.delete(sessionId);
  }

  async loadSession(
    params: ResumeSessionRequest,
  ): Promise<ResumeSessionResponse & { models: SessionModelState | null }> {
    if (!this.connection) throw new Error("Not connected");

    // If already loaded, return cached state without calling agent
    if (this._loadedSessions.has(params.sessionId)) {
      return {
        models: this._modelStates.get(params.sessionId) ?? null,
        modes: this._modeStates.get(params.sessionId) ?? null,
        configOptions: this._configOptions.get(params.sessionId) ?? null,
      };
    }

    let result: ResumeSessionResponse;
    try {
      result = await this.connection.resumeSession(params);
    } catch {
      result = await this.connection.loadSession({
        ...params,
        mcpServers: params.mcpServers ?? [],
      });
    }
    const { models: configModels, modes: configModes } = result.configOptions
      ? this.parseSessionConfigOptions(result.configOptions)
      : { models: null, modes: null };
    const models =
      configModels ?? (result as unknown as { models: SessionModelState | null }).models ?? null;
    const modes = configModes ?? result.modes ?? null;
    if (models) this._modelStates.set(params.sessionId, models);
    if (modes) this._modeStates.set(params.sessionId, modes);
    this.applyConfigOptions(params.sessionId, result.configOptions);
    this._loadedSessions.add(params.sessionId);
    this._sessionsCwdMap.set(params.sessionId, params.cwd);
    this.onSessionConnect({ sessionId: params.sessionId });
    return Object.assign(result, { models, modes });
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    if (!this.connection) throw new Error("Not connected");
    let result: SetSessionModeResponse;
    const configId = this.getConfigOptionId(params.sessionId, "mode");
    if (configId) {
      try {
        const cfg = await this.connection.setSessionConfigOption({
          sessionId: params.sessionId,
          configId,
          value: params.modeId,
        });
        this.applyConfigOptions(params.sessionId, cfg.configOptions);
        result = {};
      } catch {
        result = await this.connection.setSessionMode(params);
      }
    } else {
      result = await this.connection.setSessionMode(params);
    }
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
          await this.connection.closeSession({ sessionId: sid }).catch(() => {});
        } catch {}
      }
    }

    this._isConnected = false;
    this._modelStates.clear();
    this._modeStates.clear();
    this._configOptions.clear();
    this._loadedSessions.clear();
    this._sessionsCwdMap.clear();
    this.connection = null;

    if (this.process) {
      const proc = this.process;
      this.process = null;
      await proc.close();
    }
    if (process.env.NODE_ENV === "development") {
      console.log(`[ACP:${this.id} x]`);
    }
  }
}
