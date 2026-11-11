import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, type FilePart, type ImagePart, type ModelMessage, type TextPart } from "ai";
import {
  PROTOCOL_VERSION,
  methods,
  type AgentContext,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type ContentBlock,
  type DeleteSessionRequest,
  type DeleteSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type UsageUpdate,
} from "@agentclientprotocol/sdk";
import type { PromptResponse, Usage } from "@agentclientprotocol/sdk/unstable";
import type { ApiAgentInfo, ModelInfo, SessionModelState } from "../shared/schema";
import { ASSISTANT_AGENT_ID, ASSISTANT_SESSION_ID } from "./constants";
import { appendAssistantHistory, loadAssistantHistory, loadAssistantSession, saveAssistantSession } from "./storage";

const MODEL_CONFIG_ID = "model";
const THOUGHT_LEVEL_CONFIG_ID = "thought_level";
const DEFAULT_THOUGHT_LEVEL = "auto";
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const AGENT_DESCRIPTION = "Fello Personal Assistant";
const THOUGHT_LEVEL_OPTIONS = [
  { value: "auto", name: "Auto" }, { value: "max", name: "Max" },
  { value: "high", name: "High" }, { value: "low", name: "Low" },
];

type OpenAICompatibleModelsResponse = { data?: Array<Record<string, unknown>> };
type AssistantSession = {
  modelId: string | null;
  thoughtLevel: string;
  contextUsedTokens: number;
  history: ModelMessage[];
  abortController: AbortController | null;
};

export type AssistantAgentOptions = { agentInfo: ApiAgentInfo; workspace: string };

class AgentClientProxy {
  constructor(private readonly context: AgentContext) {}
  async sessionUpdate(params: SessionNotification): Promise<void> {
    await this.context.notify(methods.client.session.update, params);
  }
}

function isModelsResponse(value: unknown): value is OpenAICompatibleModelsResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { data?: unknown };
  return candidate.data === undefined || Array.isArray(candidate.data);
}

function toModelState(models: ModelInfo[]): SessionModelState {
  return { currentModelId: models[0]?.modelId ?? "", availableModels: models };
}

function toUrlOrString(value: string): URL | string {
  try { return new URL(value); } catch { return value; }
}

function filenameFromUri(uri: string): string | undefined {
  const path = uri.split("?")[0]?.split("#")[0] ?? "";
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] || undefined;
}

function toSafeUserMessage(prompt: ContentBlock[]): ModelMessage {
  const content: TextPart[] = prompt.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image") return { type: "text", text: "[Image]" };
    if (block.type === "audio") return { type: "text", text: "[Audio]" };
    if (block.type === "resource") return { type: "text", text: "text" in block.resource ? block.resource.text : `[Resource: ${block.resource.uri}]` };
    if (block.type === "resource_link") return { type: "text", text: `[Resource: ${block.uri}]` };
    return { type: "text", text: "[Unsupported content]" };
  });
  return { role: "user", content: content.length ? content : [{ type: "text", text: "[empty message]" }] };
}

function toModelContent(prompt: ContentBlock[]): Array<TextPart | ImagePart | FilePart> {
  return prompt.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image") return { type: "image", image: block.data || (block.uri ? toUrlOrString(block.uri) : ""), mediaType: block.mimeType };
    if (block.type === "audio") return { type: "file", data: block.data, mediaType: block.mimeType || "audio/mpeg", filename: "audio" };
    if (block.type === "resource") {
      const resource = block.resource;
      if ("text" in resource) return {
        type: "file", data: Buffer.from(resource.text, "utf8").toString("base64"),
        mediaType: resource.mimeType || "text/plain", filename: filenameFromUri(resource.uri) || "resource.txt",
      };
      return { type: "file", data: resource.blob, mediaType: resource.mimeType || "application/octet-stream", filename: filenameFromUri(resource.uri) || "resource.bin" };
    }
    if (block.type === "resource_link") return {
      type: "file", data: toUrlOrString(block.uri), mediaType: block.mimeType || "application/octet-stream",
      filename: block.name || filenameFromUri(block.uri) || "resource",
    };
    return { type: "text", text: "[Unsupported content]" };
  });
}

function buildSystemPrompt(workspace: string): string {
  return `You are Fello's personal assistant. Help with planning, writing, analysis, and conversation.

The current workspace is empty: ${workspace}. There are no files available to you. You have no filesystem, shell, MCP, task, or subagent permissions. Do not try to load AGENTS.md. Do not claim to have completed work that you did not actually perform.`;
}

export class AssistantAgent {
  private readonly provider: ReturnType<typeof createOpenAICompatible>;
  private readonly contextWindowTokens: number;
  private connection: AgentClientProxy | null = null;
  private session: AssistantSession | null = null;
  private modelsCache: SessionModelState | null = null;
  private modelsPending: Promise<SessionModelState> | null = null;

  constructor(private readonly options: AssistantAgentOptions) {
    if (options.agentInfo.provider !== "openai-compatible") {
      throw new Error(`Unsupported Assistant API provider: ${options.agentInfo.provider}`);
    }
    this.contextWindowTokens = options.agentInfo.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    this.provider = createOpenAICompatible({
      name: "openai-compatible", baseURL: options.agentInfo.baseUrl, apiKey: options.agentInfo.apiKey,
      includeUsage: true, headers: { "User-Agent": AGENT_DESCRIPTION, ...options.agentInfo.headers },
    });
  }

  setConnection(context: AgentContext): void { this.connection = new AgentClientProxy(context); }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION, agentInfo: { name: AGENT_DESCRIPTION, version: "0.1.0" },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
        sessionCapabilities: { close: {}, resume: {} },
      },
    };
  }

  async authenticate(): Promise<void> {}

  private assertSessionId(sessionId: string): void {
    if (sessionId !== ASSISTANT_SESSION_ID) throw new Error(`Assistant only supports session ${ASSISTANT_SESSION_ID}.`);
  }

  private async fetchModels(): Promise<SessionModelState> {
    const response = await fetch(`${this.options.agentInfo.baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${this.options.agentInfo.apiKey}`, "Content-Type": "application/json", ...this.options.agentInfo.headers },
    });
    if (!response.ok) throw new Error(`List models failed: ${response.status} ${response.statusText}`);
    const raw: unknown = await response.json();
    const entries = isModelsResponse(raw) && raw.data ? raw.data : [];
    return toModelState(entries.flatMap((entry) => {
      const modelId = typeof entry.id === "string" ? entry.id.trim() : "";
      return modelId ? [{ modelId, name: modelId }] : [];
    }));
  }

  private async getModels(): Promise<SessionModelState> {
    if (this.options.agentInfo.models?.length) return toModelState(this.options.agentInfo.models.map((modelId) => ({ modelId, name: modelId })));
    if (this.modelsCache) return this.modelsCache;
    if (!this.modelsPending) {
      this.modelsPending = this.fetchModels().catch(() => toModelState([])).then((models) => {
        this.modelsCache = models;
        return models;
      }).finally(() => { this.modelsPending = null; });
    }
    return this.modelsPending;
  }

  private async configOptions(session: AssistantSession): Promise<SessionConfigOption[] | null> {
    const models = await this.getModels();
    if (!models.availableModels.length) return null;
    return [
      { id: MODEL_CONFIG_ID, category: "model", name: "Model", type: "select", currentValue: session.modelId ?? models.currentModelId, options: models.availableModels.map((model) => ({ value: model.modelId, name: model.name })) },
      { id: THOUGHT_LEVEL_CONFIG_ID, category: "thought_level", name: "Thought Level", type: "select", currentValue: session.thoughtLevel, options: THOUGHT_LEVEL_OPTIONS },
    ];
  }

  private async ensureSession(): Promise<AssistantSession> {
    if (this.session) return this.session;
    const models = await this.getModels();
    const [persisted, history] = await Promise.all([loadAssistantSession(), loadAssistantHistory()]);
    const persistedModelAvailable = !!persisted?.modelId && models.availableModels.some((model) => model.modelId === persisted.modelId);
    this.session = {
      modelId: persistedModelAvailable ? persisted!.modelId : models.currentModelId || null,
      thoughtLevel: persisted?.thoughtLevel ?? DEFAULT_THOUGHT_LEVEL,
      contextUsedTokens: persisted?.contextUsedTokens ?? 0, history, abortController: null,
    };
    await this.persistSession(this.session);
    return this.session;
  }

  private async persistSession(session: AssistantSession): Promise<void> {
    await saveAssistantSession({ modelId: session.modelId, thoughtLevel: session.thoughtLevel, contextUsedTokens: session.contextUsedTokens });
  }

  private async usageUpdate(usage: UsageUpdate): Promise<void> {
    await this.connection?.sessionUpdate({ sessionId: ASSISTANT_SESSION_ID, update: { sessionUpdate: "usage_update", ...usage } });
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    const session = await this.ensureSession();
    return { sessionId: ASSISTANT_SESSION_ID, configOptions: await this.configOptions(session) };
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    this.assertSessionId(params.sessionId);
    const session = await this.ensureSession();
    await this.usageUpdate({ used: session.contextUsedTokens, size: this.contextWindowTokens });
    return { configOptions: await this.configOptions(session) };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    this.assertSessionId(params.sessionId);
    return this.resumeSession(params);
  }

  async setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
    this.assertSessionId(params.sessionId);
    const session = await this.ensureSession();
    const value = "value" in params ? params.value : null;
    if (params.configId === MODEL_CONFIG_ID && typeof value === "string") {
      const models = await this.getModels();
      if (!models.availableModels.some((model) => model.modelId === value)) throw new Error(`Unknown model: ${value}`);
      session.modelId = value;
    } else if (params.configId === THOUGHT_LEVEL_CONFIG_ID && typeof value === "string") {
      if (!THOUGHT_LEVEL_OPTIONS.some((option) => option.value === value)) throw new Error(`Unknown thought level: ${value}`);
      session.thoughtLevel = value;
    }
    await this.persistSession(session);
    return { configOptions: (await this.configOptions(session)) ?? [] };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    this.assertSessionId(params.sessionId);
    const session = await this.ensureSession();
    if (session.abortController) throw new Error("A prompt is already streaming for this session.");
    if (!session.modelId) throw new Error("No model available for Assistant.");
    const userMessage: ModelMessage = { role: "user", content: toModelContent(params.prompt) };
    const abortController = new AbortController();
    session.abortController = abortController;
    let text = "";
    try {
      const result = streamText({
        model: this.provider.chatModel(session.modelId), system: buildSystemPrompt(this.options.workspace),
        messages: [...session.history, userMessage], abortSignal: abortController.signal,
        providerOptions: session.thoughtLevel === DEFAULT_THOUGHT_LEVEL ? undefined : { openaiCompatible: { reasoningEffort: session.thoughtLevel } },
      });
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          text += part.text;
          await this.connection?.sessionUpdate({ sessionId: ASSISTANT_SESSION_ID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: part.text } } });
        } else if (part.type === "reasoning-delta") {
          await this.connection?.sessionUpdate({ sessionId: ASSISTANT_SESSION_ID, update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: part.text } } });
        }
      }
      const [usage, responseMessages] = await Promise.all([result.usage, result.responseMessages]);
      session.history.push(userMessage, ...responseMessages);
      await appendAssistantHistory([userMessage, ...responseMessages]);
      session.contextUsedTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      await this.persistSession(session);
      await this.usageUpdate({ used: session.contextUsedTokens, size: this.contextWindowTokens });
      const responseUsage: Usage = {
        totalTokens: usage.totalTokens ?? 0, inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
        thoughtTokens: usage.outputTokenDetails?.reasoningTokens, cachedReadTokens: usage.inputTokenDetails?.cacheReadTokens,
        cachedWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
      };
      return { stopReason: "end_turn", usage: responseUsage };
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      const recovery: ModelMessage[] = [toSafeUserMessage(params.prompt)];
      if (text) recovery.push({ role: "assistant", content: `${text}\n\n[${cancelled ? "Cancelled" : "Interrupted"}]` });
      session.history.push(...recovery);
      await appendAssistantHistory(recovery);
      if (cancelled) return { stopReason: "cancelled" };
      throw error;
    } finally {
      if (session.abortController === abortController) session.abortController = null;
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.assertSessionId(params.sessionId);
    this.session?.abortController?.abort();
  }

  async closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    this.assertSessionId(params.sessionId);
    if (this.session) {
      this.session.abortController?.abort();
      await this.persistSession(this.session);
      this.session = null;
    }
    return {};
  }

  async deleteSession(params: DeleteSessionRequest): Promise<DeleteSessionResponse> {
    this.assertSessionId(params.sessionId);
    throw new Error("Assistant session cannot be deleted.");
  }

  async abortAll(): Promise<void> {
    if (!this.session) return;
    this.session.abortController?.abort();
    await this.persistSession(this.session);
    this.session = null;
  }
}

export { ASSISTANT_AGENT_ID, ASSISTANT_SESSION_ID };
