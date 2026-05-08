import { randomUUID } from "crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText, type ModelMessage } from "ai";
import type {
  Agent,
  AgentSideConnection,
  ContentBlock,
  LoadSessionRequest,
  LoadSessionResponse,
  McpServer,
  ModelInfo,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionConfigOption,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SessionModelState,
  SetSessionModelRequest,
  SetSessionModelResponse,
  ToolCallContent,
  ToolKind,
} from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { ApiAgentInfo } from "../shared/schema";
import {
  createACPClientTools,
  releaseACPClientTerminals,
  type ACPAgentTerminalMap,
} from "./acp-client-tools";
import {
  closeMCPSessionTools,
  createMCPSessionTools,
  type MCPSessionTools,
} from "./mcp-tools";
import { BASE_SYSTEM_PROMPT } from "./system-prompts";

type SessionState = {
  id: string;
  cwd: string;
  additionalDirectories: string[];
  mcpServers: McpServer[];
  modelId: string | null;
  history: ModelMessage[];
  abortController: AbortController | null;
  terminals: ACPAgentTerminalMap;
  mcp: MCPSessionTools;
};

const MODEL_CONFIG_ID = "model";
type OpenAICompatibleModelsResponse = {
  data?: Array<{ id?: string }>;
};
function isOpenAICompatibleModelsResponse(value: unknown): value is OpenAICompatibleModelsResponse {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { data?: unknown };
  if (maybe.data === undefined) return true;
  return Array.isArray(maybe.data);
}

function contentBlocksToText(content: ContentBlock[]): string {
  return content
    .filter((block): block is ContentBlock & { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

const TOOL_META: Record<string, { title: string; kind: ToolKind }> = {
  read_text_file: { title: "Read Text File", kind: "read" },
  write_text_file: { title: "Write Text File", kind: "edit" },
  shell: { title: "Run Shell Command", kind: "execute" },
};

function toToolTextContent(text: string): ToolCallContent {
  return {
    type: "content",
    content: { type: "text", text },
  };
}

function buildToolCallContent(toolName: string, output: unknown): ToolCallContent[] | undefined {
  if (toolName === "read_text_file") {
    if (output && typeof output === "object" && "content" in output) {
      const content = (output as { content?: unknown }).content;
      if (typeof content === "string") return [toToolTextContent(content)];
    }
    return undefined;
  }
  if (toolName === "shell") {
    if (output && typeof output === "object") {
      const shellOutput = output as { terminalId?: unknown; output?: unknown };
      const contents: ToolCallContent[] = [];
      if (typeof shellOutput.terminalId === "string") {
        contents.push({ type: "terminal", terminalId: shellOutput.terminalId });
      }
      if (typeof shellOutput.output === "string" && shellOutput.output.length > 0) {
        contents.push(toToolTextContent(shellOutput.output));
      }
      return contents.length > 0 ? contents : undefined;
    }
    return undefined;
  }
  if (typeof output === "string" && output.length > 0) {
    return [toToolTextContent(output)];
  }
  if (output && typeof output === "object" && "content" in output) {
    const content = (output as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (!part || typeof part !== "object") return null;
          const maybe = part as { type?: unknown; text?: unknown };
          if (maybe.type === "text" && typeof maybe.text === "string") return maybe.text;
          return null;
        })
        .filter((item): item is string => item !== null)
        .join("\n")
        .trim();
      if (text.length > 0) return [toToolTextContent(text)];
    }
  }
  return undefined;
}

function normalizeAdditionalDirectories(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function normalizeMcpServers(value: McpServer[] | undefined): McpServer[] {
  return Array.isArray(value) ? value : [];
}

function buildWorkspaceSystemPrompt(cwd: string, additionalDirectories: string[]): string {
  const extras =
    additionalDirectories.length > 0
      ? ` Additional workspace roots: ${additionalDirectories.join(", ")}.`
      : "";
  const workspacePrompt = `Current session working directory (cwd): ${cwd}.${extras} Use this as the default base path for relative paths.`;
  return `${BASE_SYSTEM_PROMPT}\n\n${workspacePrompt}`;
}

export class OpenaiCompatibleAgent implements Agent {
  private sessions = new Map<string, SessionState>();
  private provider: ReturnType<typeof createOpenAICompatible>;
  private connection: AgentSideConnection | null = null;
  private baseUrl: string;
  private apiKey: string;
  private headers: Record<string, string>;
  private modelsCache: SessionModelState | null = null;
  private modelsFetchedAt = 0;
  private modelsPending: Promise<SessionModelState> | null = null;
  private readonly modelsCacheTtlMs = 5 * 60 * 1000;

  constructor(options: ApiAgentInfo) {
    if (options.provider !== "openai-compatible") {
      throw new Error(`Unsupported api provider: ${options.provider}`);
    }
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.headers = options.headers || {};
    this.provider = createOpenAICompatible({
      name: "openai-compatible",
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      headers: this.headers,
    });
  }

  setConnection(connection: AgentSideConnection): void {
    this.connection = connection;
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: "Fello OpenAI-Compatible opencode",
        version: "0.1.0",
      },
    };
  }

  async authenticate() {
    return;
  }

  private toSessionModelState(models: ModelInfo[]): SessionModelState {
    const availableModels = models;
    return {
      currentModelId: availableModels[0]?.modelId || "",
      availableModels,
    };
  }

  private async fetchModels(): Promise<SessionModelState> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...this.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`List models failed: ${response.status} ${response.statusText}`);
    }
    const payloadRaw: unknown = await response.json();
    const payload: OpenAICompatibleModelsResponse = isOpenAICompatibleModelsResponse(payloadRaw)
      ? payloadRaw
      : {};
    const entries = Array.isArray(payload.data) ? payload.data : [];
    const models: ModelInfo[] = entries
      .map((item) => {
        if (typeof item?.id !== "string" || item.id.trim().length === 0) return null;
        return { modelId: item.id, name: item.id };
      })
      .filter((item): item is ModelInfo => item !== null);
    return this.toSessionModelState(models);
  }

  private async getModels(forceRefresh = false): Promise<SessionModelState> {
    const isCacheValid =
      !forceRefresh &&
      this.modelsCache &&
      Date.now() - this.modelsFetchedAt < this.modelsCacheTtlMs;
    if (isCacheValid && this.modelsCache) {
      return this.modelsCache;
    }
    if (this.modelsPending) {
      return this.modelsPending;
    }
    this.modelsPending = this.fetchModels()
      .catch(() => this.toSessionModelState([]))
      .then((state) => {
        this.modelsCache = state;
        this.modelsFetchedAt = Date.now();
        return state;
      })
      .finally(() => {
        this.modelsPending = null;
      });
    return this.modelsPending;
  }

  private async buildConfigOptions(
    currentModelId: string | null,
  ): Promise<SessionConfigOption[] | null> {
    const modelState = await this.getModels();
    if (modelState.availableModels.length === 0) return null;
    return [
      {
        id: MODEL_CONFIG_ID,
        category: "model",
        name: "Model",
        type: "select",
        currentValue: currentModelId || modelState.currentModelId || modelState.availableModels[0].modelId,
        options: modelState.availableModels.map((model) => ({
          value: model.modelId,
          name: model.name,
        })),
      },
    ];
  }

  private async reconnectSessionMcp(session: SessionState, mcpServers: McpServer[]): Promise<void> {
    const previousMcp = session.mcp;
    const nextMcp = await createMCPSessionTools({
      mcpServers,
      cwd: session.cwd,
    });
    session.mcpServers = mcpServers;
    session.mcp = nextMcp;
    await closeMCPSessionTools(previousMcp).catch(() => {});
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const modelState = await this.getModels();
    const sessionId = randomUUID();
    const modelId = modelState.currentModelId || null;
    const mcpServers = normalizeMcpServers(params.mcpServers);
    const mcp = await createMCPSessionTools({
      mcpServers,
      cwd: params.cwd,
    });
    this.sessions.set(sessionId, {
      id: sessionId,
      cwd: params.cwd,
      additionalDirectories: normalizeAdditionalDirectories(params.additionalDirectories),
      mcpServers,
      modelId,
      history: [],
      abortController: null,
      terminals: new Map(),
      mcp,
    });
    return {
      sessionId,
      models: modelState.availableModels.length > 0 ? modelState : null,
      configOptions: await this.buildConfigOptions(modelId),
    };
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    const modelState = await this.getModels();
    const previous = this.sessions.get(params.sessionId);
    if (!previous) {
      const mcpServers = normalizeMcpServers(params.mcpServers);
      const mcp = await createMCPSessionTools({
        mcpServers,
        cwd: params.cwd,
      });
      this.sessions.set(params.sessionId, {
        id: params.sessionId,
        cwd: params.cwd,
        additionalDirectories: normalizeAdditionalDirectories(params.additionalDirectories),
        mcpServers,
        modelId: modelState.currentModelId || null,
        history: [],
        abortController: null,
        terminals: new Map(),
        mcp,
      });
    }
    const active = this.sessions.get(params.sessionId)!;
    const previousCwd = active.cwd;
    active.cwd = params.cwd;
    active.additionalDirectories = normalizeAdditionalDirectories(params.additionalDirectories);
    if (params.mcpServers !== undefined || previousCwd !== params.cwd) {
      const nextMcpServers = normalizeMcpServers(params.mcpServers) || [];
      const hasMcpConfigChange = params.mcpServers !== undefined;
      if (hasMcpConfigChange || previousCwd !== params.cwd) {
        await this.reconnectSessionMcp(active, hasMcpConfigChange ? nextMcpServers : active.mcpServers);
      }
    }
    const currentModelExists = !!active.modelId && modelState.availableModels.some((model) => model.modelId === active.modelId);
    if (!currentModelExists) {
      active.modelId = modelState.currentModelId || null;
    }
    const models =
      modelState.availableModels.length > 0
        ? {
            currentModelId: active.modelId || modelState.currentModelId || "",
            availableModels: modelState.availableModels,
          }
        : null;
    return {
      models,
      configOptions: await this.buildConfigOptions(active.modelId),
    };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    return this.resumeSession(params);
  }

  async unstable_setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) return {};
    session.modelId = params.modelId;
    return {};
  }

  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return { configOptions: [] };
    }
    const value = "value" in params ? params.value : null;
    if (params.configId === MODEL_CONFIG_ID && typeof value === "string") {
      const modelState = await this.getModels();
      const isValidModel = modelState.availableModels.some((model) => model.modelId === value);
      if (!isValidModel) {
        throw new Error(`Unknown model: ${value}`);
      }
      session.modelId = value;
    }
    return {
      configOptions: (await this.buildConfigOptions(session.modelId)) || [],
    };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }

    const userText = contentBlocksToText(params.prompt);
    if (!userText) {
      return { stopReason: "end_turn" };
    }

    session.history.push({ role: "user", content: userText });
    const abortController = new AbortController();
    session.abortController = abortController;

    try {
      if (!session.modelId) {
        throw new Error("No model available for current session.");
      }
      const result = streamText({
        model: this.provider.chatModel(session.modelId),
        system: buildWorkspaceSystemPrompt(session.cwd, session.additionalDirectories),
        messages: session.history,
        tools: {
          ...session.mcp.tools,
          ...createACPClientTools({
            sessionId: params.sessionId,
            terminals: session.terminals,
            getConnection: () => this.connection,
          }),
        },
        experimental_onToolCallStart: async ({ toolCall }) => {
          if (!this.connection) return;
          const meta = TOOL_META[toolCall.toolName] ?? session.mcp.toolMeta[toolCall.toolName] ?? { title: toolCall.toolName, kind: "other" };
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: toolCall.toolCallId,
              title: meta.title,
              kind: meta.kind,
              status: "in_progress",
              rawInput: toolCall.input,
            },
          });
        },
        experimental_onToolCallFinish: async (event) => {
          if (!this.connection) return;
          const toolName = event.toolCall.toolName;
          const content = event.success ? buildToolCallContent(toolName, event.output) : undefined;
          const errorText =
            !event.success ? (event.error instanceof Error ? event.error.message : String(event.error)) : null;
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: event.toolCall.toolCallId,
              status: event.success ? "completed" : "failed",
              rawOutput: event.success ? event.output : { error: errorText },
              ...(content ? { content } : {}),
              ...(!event.success && errorText ? { content: [toToolTextContent(errorText)] } : {}),
            },
          });
        },
        stopWhen: stepCountIs(80),
        abortSignal: abortController.signal,
      });

      let fullText = "";
      for await (const delta of result.textStream) {
        if (!delta) continue;
        fullText += delta;
        if (this.connection) {
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: delta },
            },
          });
        }
      }
      session.history.push({ role: "assistant", content: fullText });
      return { stopReason: "end_turn" };
    } catch (err) {
      if (abortController.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw err;
    } finally {
      session.abortController = null;
    }
  }

  async cancel(params: { sessionId: string }) {
    const session = this.sessions.get(params.sessionId);
    session?.abortController?.abort();
    if (session) session.abortController = null;
  }

  abortAll(): void {
    for (const session of this.sessions.values()) {
      session.abortController?.abort();
      session.abortController = null;
      releaseACPClientTerminals(session.terminals);
      void closeMCPSessionTools(session.mcp);
    }
    this.sessions.clear();
  }
}
