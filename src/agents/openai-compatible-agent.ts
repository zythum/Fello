import { randomUUID } from "crypto";
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  stepCountIs,
  streamText,
  generateText,
  type ModelMessage,
  type TextPart,
  type ToolSet,
} from "ai";
import type {
  Agent,
  AgentSideConnection,
  AvailableCommand,
  CancelNotification,
  CloseSessionRequest,
  CloseSessionResponse,
  ContentBlock,
  DeleteSessionRequest,
  DeleteSessionResponse,
  InitializeRequest,
  InitializeResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionConfigOption,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  Usage,
} from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { ApiAgentInfo, ModelInfo, SessionModelState } from "../shared/schema";
import { closeACPClientTools } from "./acp-client-tools";
import { closeMCPSessionTools } from "./mcp-tools";
import { createSessionState, type SessionState } from "./session-state";
import {
  appendPersistedSessionHistory,
  deletePersistedSessionDirectory,
  loadPersistedSessionHistory,
  loadPersistedSessionState,
  savePersistedSessionHistory,
  savePersistedSessionState,
} from "./storage";
import { BASE_SYSTEM_PROMPT } from "./system-prompts";
import { createSubagentTool } from "./subagent-tool";
import {
  embeddedResourceToFilePart,
  audioContentToFilePart,
  filePartToEmbeddedResourceResource,
  imageContentToImagePart,
  resourceLinkToFilePart,
  textContentToTextPart,
} from "./utils";

const MODEL_CONFIG_ID = "model";

/** Default context window tokens when none is configured. */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

function buildWorkspaceSystemPrompt(cwd: string, additionalDirectories: string[]): string {
  const extras =
    additionalDirectories.length > 0
      ? ` Additional workspace roots: ${additionalDirectories.join(", ")}.`
      : "";
  const workspacePrompt = `Current session working directory (cwd): ${cwd}.${extras} Use this as the default base path for relative paths.`;

  // Temporal & environment context — LLMs often hallucinate the current time
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA"); // YYYY-MM-DD format
  const timeStr = now.toLocaleTimeString("en-US", { hour12: false });
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezoneOffset = -now.getTimezoneOffset();
  const offsetSign = timezoneOffset >= 0 ? "+" : "-";
  const offsetHours = String(Math.floor(Math.abs(timezoneOffset) / 60)).padStart(2, "0");
  const offsetMinutes = String(Math.abs(timezoneOffset) % 60).padStart(2, "0");
  const utcOffset = `UTC${offsetSign}${offsetHours}:${offsetMinutes}`;
  const platform = process.platform; // darwin, linux, win32

  const envContext = `Date and time: ${dateStr} ${timeStr} (${weekday})
Timezone: ${timezone} (${utcOffset})
Platform: ${platform}`;

  let prompt = `${BASE_SYSTEM_PROMPT}\n\n${workspacePrompt}\n\n${envContext}`;

  // Load project-level AGENTS.md if present (skip if > 50 KB)
  try {
    const agentsMdPath = join(cwd, "AGENTS.md");
    if (statSync(agentsMdPath).size <= 50 * 1024) {
      const agentsMd = readFileSync(agentsMdPath, "utf-8").trim();
      if (agentsMd) {
        prompt += `\n\n<project_conventions>\n${agentsMd}\n</project_conventions>`;
      }
    }
  } catch {
    // File doesn't exist or unreadable — skip silently
  }

  return prompt;
}

type OpenAICompatibleModelsResponse = {
  data?: Array<Record<string, unknown>>;
};
function isOpenAICompatibleModelsResponse(value: unknown): value is OpenAICompatibleModelsResponse {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { data?: unknown };
  if (maybe.data === undefined) return true;
  return Array.isArray(maybe.data);
}

/** 将模版字符串中的 {fieldName} 替换为 modelItem 中对应字段的值 */
function applyModelIdTemplate(template: string, modelItem: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, fieldName) => {
    const value = modelItem[fieldName];
    if (value === undefined || value === null) return _match;
    return String(value);
  });
}

const AgentDescription = "Fello/0.1.1 CodeAgent OpenaiCompatibleAgent opencode codex";

/** 将 ContentBlock 列表转为纯文本版本的 ModelMessage（用于失败恢复，避免非 text block 污染历史） */
function buildSafeUserMessage(prompt: ContentBlock[]): ModelMessage {
  const safeContent: TextPart[] = prompt.map((block) => {
    if (block.type === "text") {
      return textContentToTextPart(block);
    }
    if (block.type === "image") {
      const desc = block.uri ? `[Image: ${block.uri}]` : `[Image]`;
      return textContentToTextPart({ text: desc });
    }
    if (block.type === "audio") {
      return textContentToTextPart({ text: `[Audio]` });
    }
    if (block.type === "resource") {
      const resource = block.resource;
      if ("text" in resource) {
        return textContentToTextPart({ text: resource.text });
      }
      const uri = resource.uri || "";
      const mime = resource.mimeType || "unknown";
      return textContentToTextPart({ text: `[Resource: ${uri} (${mime})]` });
    }
    if (block.type === "resource_link") {
      return textContentToTextPart({ text: `[Resource: ${block.uri}]` });
    }
    return textContentToTextPart({ text: `[Unknown content]` });
  });
  // 保底：空 prompt 给一个占位文本
  if (safeContent.length === 0) {
    safeContent.push({ type: "text", text: "[empty message]" });
  }
  return { role: "user", content: safeContent };
}

const AVAILABLE_COMMANDS: AvailableCommand[] = [
  { name: "compact", description: "Compress conversation context" },
];

export class OpenaiCompatibleAgent implements Agent {
  private sessions = new Map<string, SessionState>();
  private provider: ReturnType<typeof createOpenAICompatible>;
  private connection: AgentSideConnection | null = null;
  private agentId: string;
  private baseUrl: string;
  private apiKey: string;
  private headers: Record<string, string>;
  private contextWindowTokens: number;
  private modelIdTemplate: string | undefined;
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
    this.agentId = options.id;
    this.headers = options.headers || {};
    this.contextWindowTokens = options.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    this.modelIdTemplate = options.modelIdTemplate;
    this.provider = createOpenAICompatible({
      name: "openai-compatible",
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      headers: {
        "User-Agent": AgentDescription,
        ...this.headers,
      },
    });
  }

  setConnection(connection: AgentSideConnection): void {
    this.connection = connection;
  }

  async initialize(_request: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: AgentDescription,
        version: "0.1.0",
      },
      agentCapabilities: {
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true,
        },
        sessionCapabilities: {
          additionalDirectories: {},
          close: {},
          resume: {},
          delete: {},
        },
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
        const rawId = item.id.trim();
        const modelId = this.modelIdTemplate
          ? applyModelIdTemplate(this.modelIdTemplate, item)
          : rawId;
        if (!modelId.trim()) return null;
        return { modelId, name: modelId };
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

  private async persistSessionState(session: SessionState): Promise<void> {
    try {
      await savePersistedSessionState({
        agentId: this.agentId,
        sessionId: session.id,
        modelId: session.modelId,
        allowedToolKinds: Array.from(session.allowedToolKinds),
        contextUsedTokens: session.contextUsedTokens,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[OpenaiCompatibleAgent] Failed to persist session state for ${session.id}: ${message}`,
      );
    }
  }

  private async appendSessionHistory(
    sessionId: string,
    ...messages: ModelMessage[]
  ): Promise<void> {
    if (messages.length === 0) return;
    try {
      await appendPersistedSessionHistory({
        agentId: this.agentId,
        sessionId,
        messages,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[OpenaiCompatibleAgent] Failed to append session history for ${sessionId}: ${message}`,
      );
    }
  }

  private async pushAvailableCommands(sessionId: string): Promise<void> {
    if (!this.connection) return;
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: AVAILABLE_COMMANDS,
      },
    });
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const modelState = await this.getModels();
    const sessionId = randomUUID();
    const modelId = modelState.currentModelId ?? modelState.availableModels[0]?.modelId ?? null;
    let sessionRef: SessionState | null = null;
    const session = await createSessionState({
      sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
      mcpServers: params.mcpServers,
      modelId,
      getConnection: () => this.connection,
      onAllowedToolKindsChanged: async () => {
        if (!sessionRef) return;
        await this.persistSessionState(sessionRef);
      },
    });
    sessionRef = session;
    this.sessions.set(sessionId, session);
    await this.persistSessionState(session);
    // 消息不能推太早，等客户端连接就绪后再推送
    setTimeout(() => {
      this.pushAvailableCommands(sessionId).catch(() => {});
    }, 500);
    return {
      sessionId,
      configOptions: await this.buildConfigOptions(modelId),
    };
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    const modelState = await this.getModels();
    const [persistedState, persistedHistory] = await Promise.all([
      loadPersistedSessionState({
        agentId: this.agentId,
        sessionId: params.sessionId,
      }),
      loadPersistedSessionHistory({
        agentId: this.agentId,
        sessionId: params.sessionId,
      }),
    ]);
    const previous = this.sessions.get(params.sessionId);
    if (previous) {
      throw new Error(
        `Session is already active: ${params.sessionId}. Close the active session before calling load/resume again.`,
      );
    }
    let sessionRef: SessionState | null = null;
    const active = await createSessionState({
      sessionId: params.sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
      mcpServers: params.mcpServers,
      modelId:
        persistedState?.modelId ??
        modelState.currentModelId ??
        modelState.availableModels[0]?.modelId ??
        null,
      getConnection: () => this.connection,
      history: persistedHistory,
      allowedToolKinds: persistedState?.allowedToolKinds,
      onAllowedToolKindsChanged: async () => {
        if (!sessionRef) return;
        await this.persistSessionState(sessionRef);
      },
    });
    sessionRef = active;
    this.sessions.set(params.sessionId, active);
    const currentModelExists =
      !!active.modelId &&
      modelState.availableModels.some((model) => model.modelId === active.modelId);
    if (!currentModelExists) {
      active.modelId = modelState.currentModelId || null;
    }
    // Restore context usage from persisted state and notify client
    if (persistedState) {
      active.contextUsedTokens = persistedState.contextUsedTokens;
    }
    if (this.connection) {
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "usage_update",
          used: active.contextUsedTokens,
          size: this.contextWindowTokens,
        },
      });
    }
    await this.persistSessionState(active);
    await this.pushAvailableCommands(params.sessionId);
    return {
      configOptions: await this.buildConfigOptions(active.modelId),
    };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    return this.resumeSession(params);
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
      await this.persistSessionState(session);
    }
    return {
      configOptions: (await this.buildConfigOptions(session.modelId)) || [],
    };
  }

  private extractSlashCommand(params: PromptRequest): { command: string; content: string } | null {
    const first = params.prompt[0];
    if (first?.type === "text" && first.text.trim().startsWith("/")) {
      const text = first.text.trim();
      const spaceIdx = text.indexOf(" ");
      if (spaceIdx === -1) return { command: text.slice(1), content: "" };
      return { command: text.slice(1, spaceIdx), content: text.slice(spaceIdx + 1) };
    }
    return null;
  }

  private async handleCompact(session: SessionState, sessionId: string): Promise<PromptResponse> {
    if (!session.modelId || session.history.length === 0) {
      return { stopReason: "end_turn" };
    }

    if (session.history.length < 15) {
      if (this.connection) {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `No need to compact` },
          },
        });
      }
      return { stopReason: "end_turn" };
    }

    const summaryResult = await generateText({
      model: this.provider.chatModel(session.modelId),
      messages: [
        ...session.history,
        {
          role: "user",
          content: `Compress the conversation into a structured markdown summary.
 Include: key decisions, code changes (with file paths),
 technical context, and pending tasks.
 Use headings and bullet points for clarity.
 Detect the user's commonly used language from the conversation history and respond in that language.
 Output only the summary.`,
        },
      ],
      maxOutputTokens: 5000,
    });

    const summary = summaryResult.text;
    session.history = [
      {
        role: "system",
        content: `Summary of previous conversation: ${summary}`,
      },
    ];
    await savePersistedSessionHistory({
      agentId: this.agentId,
      sessionId: session.id,
      messages: session.history,
    });

    if (this.connection) {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: summary },
        },
      });
    }

    // Update context usage
    const outputTokens = summaryResult.usage?.outputTokens ?? 0;
    session.contextUsedTokens = outputTokens;

    if (this.connection) {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "usage_update",
          used: session.contextUsedTokens,
          size: this.contextWindowTokens,
        },
      });
    }

    await this.persistSessionState(session);
    return { stopReason: "end_turn" };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    if (session.abortController) {
      throw new Error("A prompt is already streaming for this session.");
    }

    // Slash command handling
    const slashCommand = this.extractSlashCommand(params);
    if (slashCommand) {
      const { command } = slashCommand;
      switch (command) {
        case "compact":
          return this.handleCompact(session, params.sessionId);
        // Skip Unknown command
        // default:
        //   if (this.connection) {
        //     await this.connection.sessionUpdate({
        //       sessionId: params.sessionId,
        //       update: {
        //         sessionUpdate: "agent_message_chunk",
        //         content: { type: "text", text: `Unknown command: /${command}` },
        //       },
        //     });
        //   }
        //   return { stopReason: "end_turn" };
      }
    }

    const userContent = params.prompt.map((contentBlock) => {
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

    // 如果 session 历史为空，生成一个简短的标题
    if (session.history.length === 0 && session.modelId) {
      // 从 userContent 中提取文本部分
      const textParts = userContent.filter(
        (part) =>
          typeof part === "object" && part !== null && "type" in part && part.type === "text",
      );
      const userText = textParts
        .map((part) => part.text)
        .join(" ")
        .slice(0, 200)
        .trim(); // 限制长度
      if (userText) {
        try {
          const titleResult = await generateText({
            model: this.provider.chatModel(session.modelId),
            prompt: `Generate a very short title (3-10 words) that summarizes the following user query. Respond only with the title, no quotes or additional text. User query: ${userText}`,
            maxOutputTokens: 100,
            temperature: 0.3,
            providerOptions: {
              openaiCompatible: {
                thinking: { type: "disabled" },
                enable_thinking: false,
                reasoning_effort: "low",
              },
            },
          });
          const title = titleResult.text.trim();
          if (title && this.connection) {
            await this.connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "session_info_update",
                title: title,
              },
            });
          }
        } catch (error) {
          // 标题生成失败，忽略错误，继续主要流程
          console.warn(`Failed to generate session title: ${error}`);
        }
      }
    }

    const userMessage: ModelMessage = { role: "user", content: userContent };

    const abortController = new AbortController();
    session.abortController = abortController;

    // 用于在失败时保留已产生的 assistant 文本
    let accumulatedText = "";

    try {
      if (!session.modelId) {
        throw new Error("No model available for current session.");
      }
      const systemPrompt = buildWorkspaceSystemPrompt(session.cwd, session.additionalDirectories);
      const sharedTools: ToolSet = {
        ...session.mcp.tools,
        ...session.acp.tools,
      };
      const subagentTool = createSubagentTool({
        sessionId: params.sessionId,
        cwd: session.cwd,
        getConnection: () => this.connection,
        getModel: () => this.provider.chatModel(session.modelId!),
        systemPrompt,
        parentSignal: abortController.signal,
      });
      const result = streamText({
        model: this.provider.chatModel(session.modelId),
        system: systemPrompt,
        messages: [...session.history, userMessage],
        tools: {
          ...sharedTools,
          ...subagentTool,
        },
        stopWhen: stepCountIs(128),
        abortSignal: abortController.signal,
      });

      for await (const part of result.fullStream) {
        if (!this.connection) continue;

        if (part.type === "text-delta") {
          if (!part.text) continue;
          accumulatedText += part.text;
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
                    type: "resource",
                    ...filePartToEmbeddedResourceResource({
                      type: "file",
                      data: part.file.base64,
                      mediaType: part.file.mediaType,
                    }),
                  },
            },
          });
        }
      }

      const response = await result.response;
      session.history.push(userMessage, ...response.messages);
      await this.appendSessionHistory(session.id, userMessage, ...response.messages);

      // Get per-turn usage (sum of all steps) and last-step usage for context tracking
      const [turnUsage, lastStepUsage] = await Promise.all([result.totalUsage, result.usage]);
      session.contextUsedTokens =
        (lastStepUsage.inputTokens ?? 0) + (lastStepUsage.outputTokens ?? 0);

      // Build ACP usage object (per-turn data)
      const usage: Usage = {
        totalTokens: turnUsage.totalTokens ?? 0,
        inputTokens: turnUsage.inputTokens ?? 0,
        outputTokens: turnUsage.outputTokens ?? 0,
        thoughtTokens: turnUsage.outputTokenDetails?.reasoningTokens,
        cachedReadTokens: turnUsage.inputTokenDetails?.cacheReadTokens,
        cachedWriteTokens: turnUsage.inputTokenDetails?.cacheWriteTokens,
      };

      // Send context window usage_update via session/update
      if (this.connection) {
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "usage_update",
            used: session.contextUsedTokens,
            size: this.contextWindowTokens,
          },
        });
      }

      return {
        stopReason: "end_turn",
        usage,
      };
    } catch (err) {
      if (abortController.signal.aborted) {
        // 用户主动停止时，也要保存已产生的上下文，这样"继续"时有历史
        const safeUserMessage = buildSafeUserMessage(params.prompt);
        const historyEntries: ModelMessage[] = [safeUserMessage];
        if (accumulatedText.trim()) {
          historyEntries.push({
            role: "assistant",
            content:
              accumulatedText + "\n\n_[Generation stopped by user — continue from user's request]_",
          });
        }
        session.history.push(...historyEntries);
        await this.appendSessionHistory(session.id, ...historyEntries);
        return { stopReason: "cancelled" };
      }

      // 失败时仍保存用户消息（纯文本版本，不含 image/audio/resource base64），
      // 以及已产生的 assistant 文本，这样用户说"继续"时 LLM 知道上下文。
      const safeUserMessage = buildSafeUserMessage(params.prompt);
      const historyEntries: ModelMessage[] = [safeUserMessage];
      if (accumulatedText.trim()) {
        historyEntries.push({
          role: "assistant",
          content:
            accumulatedText + "\n\n_[Generation interrupted — continue from user's request]_",
        });
      }
      session.history.push(...historyEntries);
      await this.appendSessionHistory(session.id, ...historyEntries);

      throw err;
    } finally {
      session.abortController = null;
      await this.persistSessionState(session);
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

    await this.persistSessionState(session);
    this.sessions.delete(params.sessionId);
    session.abortController?.abort();
    session.abortController = null;
    await closeACPClientTools(session.acp);
    await closeMCPSessionTools(session.mcp);
    return {};
  }

  async deleteSession(params: DeleteSessionRequest): Promise<DeleteSessionResponse> {
    // 如果会话当前是活跃的，先关闭它（清理资源）
    const session = this.sessions.get(params.sessionId);
    if (session) {
      await this.closeSession(params);
    }
    // 删除持久化的会话目录（session.json + history.jsonl）
    deletePersistedSessionDirectory({
      agentId: this.agentId,
      sessionId: params.sessionId,
    });

    return {};
  }

  async abortAll(): Promise<void> {
    const releases: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      session.abortController?.abort();
      session.abortController = null;
      releases.push(this.persistSessionState(session));
      releases.push(closeACPClientTools(session.acp));
      releases.push(closeMCPSessionTools(session.mcp));
    }
    this.sessions.clear();
    await Promise.all(releases);
  }
}
