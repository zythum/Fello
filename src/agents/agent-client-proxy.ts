/**
 * Thin wrapper around `AgentContext` from the new ACP SDK app-style API.
 *
 * Provides the convenience methods that the old `AgentSideConnection` had
 * (sessionUpdate, requestPermission, readTextFile, writeTextFile, createTerminal)
 * so that existing agent-side code needs minimal changes beyond import updates.
 */
import {
  methods,
  type AgentContext,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type TerminalOutputResponse,
  type WaitForTerminalExitResponse,
  type KillTerminalResponse,
  type ReleaseTerminalResponse,
} from "@agentclientprotocol/sdk";

/**
 * A terminal handle that wraps raw ACP terminal requests.
 * Replaces the SDK's internal TerminalHandle (which requires AgentSideConnection).
 */
export class TerminalHandle {
  constructor(
    public readonly id: string,
    private readonly sessionId: string,
    private readonly ctx: AgentContext,
  ) {}

  async currentOutput(): Promise<TerminalOutputResponse> {
    return this.ctx.request(methods.client.terminal.output, {
      sessionId: this.sessionId,
      terminalId: this.id,
    });
  }

  async waitForExit(): Promise<WaitForTerminalExitResponse> {
    return this.ctx.request(methods.client.terminal.waitForExit, {
      sessionId: this.sessionId,
      terminalId: this.id,
    });
  }

  async kill(): Promise<KillTerminalResponse> {
    return this.ctx.request(methods.client.terminal.kill, {
      sessionId: this.sessionId,
      terminalId: this.id,
    });
  }

  async release(): Promise<ReleaseTerminalResponse | void> {
    return this.ctx.request(methods.client.terminal.release, {
      sessionId: this.sessionId,
      terminalId: this.id,
    });
  }
}

/**
 * Wraps an AgentContext to provide the same convenience methods as the
 * deprecated AgentSideConnection.
 */
export class AgentClientProxy {
  constructor(private readonly ctx: AgentContext) {}

  async sessionUpdate(params: SessionNotification): Promise<void> {
    await this.ctx.notify(methods.client.session.update, params);
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    return this.ctx.request(methods.client.session.requestPermission, params);
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    return this.ctx.request(methods.client.fs.readTextFile, params);
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    return this.ctx.request(methods.client.fs.writeTextFile, params);
  }

  async createTerminal(params: CreateTerminalRequest): Promise<TerminalHandle> {
    const response: CreateTerminalResponse = await this.ctx.request(
      methods.client.terminal.create,
      params,
    );
    return new TerminalHandle(response.terminalId, params.sessionId, this.ctx);
  }
}
