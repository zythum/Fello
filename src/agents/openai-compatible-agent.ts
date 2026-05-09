import { randomUUID } from "crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText } from "ai";
import type {
  Agent,
  AgentSideConnection,
  CancelNotification,
  CloseSessionRequest,
  CloseSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
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
} from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { ApiAgentInfo } from "../shared/schema";
import { closeACPClientTools } from "./acp-client-tools";
import { closeMCPSessionTools } from "./mcp-tools";
import { createSessionState, type SessionState } from "./session-state";
import { BASE_SYSTEM_PROMPT } from "./system-prompts";
import {
  embeddedResourceToFilePart,
  audioContentToFilePart,
  filePartToEmbeddedResourceResource,
  imageContentToImagePart,
  resourceLinkToFilePart,
  textContentToTextPart,
} from "./utils";

const MODEL_CONFIG_ID = "model";

function buildWorkspaceSystemPrompt(cwd: string, additionalDirectories: string[]): string {
  const extras =
    additionalDirectories.length > 0
      ? ` Additional workspace roots: ${additionalDirectories.join(", ")}.`
      : "";
  const workspacePrompt = `Current session working directory (cwd): ${cwd}.${extras} Use this as the default base path for relative paths.`;
  return `${BASE_SYSTEM_PROMPT}\n\n${workspacePrompt}`;
}

type OpenAICompatibleModelsResponse = {
  data?: Array<{ id?: string }>;
};
function isOpenAICompatibleModelsResponse(value: unknown): value is OpenAICompatibleModelsResponse {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { data?: unknown };
  if (maybe.data === undefined) return true;
  return Array.isArray(maybe.data);
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
        currentValue:
          currentModelId || modelState.currentModelId || modelState.availableModels[0].modelId,
        options: modelState.availableModels.map((model) => ({
          value: model.modelId,
          name: model.name,
        })),
      },
    ];
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const modelState = await this.getModels();
    const sessionId = randomUUID();
    const modelId = modelState.currentModelId ?? modelState.availableModels[0]?.modelId ?? null;
    const session = await createSessionState({
      sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
      mcpServers: params.mcpServers,
      modelId,
      getConnection: () => this.connection,
    });
    this.sessions.set(sessionId, session);
    return {
      sessionId,
      models: modelState.availableModels.length > 0 ? modelState : null,
      configOptions: await this.buildConfigOptions(modelId),
    };
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    const modelState = await this.getModels();
    const previous = this.sessions.get(params.sessionId);
    if (previous) {
      throw new Error(
        `Session is already active: ${params.sessionId}. Close the active session before calling load/resume again.`,
      );
    }
    const active = await createSessionState({
      sessionId: params.sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
      mcpServers: params.mcpServers,
      modelId: modelState.currentModelId ?? modelState.availableModels[0]?.modelId ?? null,
      getConnection: () => this.connection,
    });
    this.sessions.set(params.sessionId, active);
    const currentModelExists =
      !!active.modelId &&
      modelState.availableModels.some((model) => model.modelId === active.modelId);
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
    if (session.abortController) {
      throw new Error("A prompt is already streaming for this session.");
    }

    const userText = params.prompt.map((contentBlock) => {
      if (contentBlock.type === "text") {
        return textContentToTextPart(contentBlock);
      }
      if (contentBlock.type === "image") {
        return imageContentToImagePart(contentBlock);
      }
      if (contentBlock.type === "audio") {
        return audioContentToFilePart(contentBlock);
      }
      if (contentBlock.type === "resource") {
        return embeddedResourceToFilePart(contentBlock);
      }
      if (contentBlock.type === "resource_link") {
        return resourceLinkToFilePart(contentBlock);
      }
      return textContentToTextPart({ text: JSON.stringify(contentBlock) });
    });

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
          ...session.acp.tools,
        },
        stopWhen: stepCountIs(80),
        abortSignal: abortController.signal,
      });

      for await (const part of result.fullStream) {
        if (!this.connection) continue;

        if (part.type === "text-delta") {
          if (!part.text) continue;
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: part.text },
            },
          });
          continue;
        }

        if (part.type === "reasoning-delta") {
          if (!part.text) continue;
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: part.text },
            },
          });
          continue;
        }

        if (part.type === "file") {
          const isImage = part.file.mediaType.startsWith("image/");
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: isImage
                ? {
                    type: "image",
                    data: part.file.base64,
                    mimeType: part.file.mediaType,
                  }
                : {
                  type: 'resource',
                  ...filePartToEmbeddedResourceResource({
                    type: 'file',
                    data: part.file.base64,
                    mediaType: part.file.mediaType,
                  })
                },
            },
          });
        }
      }
      const response = await result.response;
      session.history.push(...response.messages);
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

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    session?.abortController?.abort();
    if (session) session.abortController = null;
  }

  async closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) return {};

    this.sessions.delete(params.sessionId);
    session.abortController?.abort();
    session.abortController = null;
    await closeACPClientTools(session.acp);
    await closeMCPSessionTools(session.mcp);
    return {};
  }

  async abortAll(): Promise<void> {
    const releases: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      session.abortController?.abort();
      session.abortController = null;
      releases.push(closeACPClientTools(session.acp));
      releases.push(closeMCPSessionTools(session.mcp));
    }
    this.sessions.clear();
    await Promise.all(releases);
  }
}
