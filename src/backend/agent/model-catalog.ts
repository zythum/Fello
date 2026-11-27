/**
 * Agent 模型候选（供表单的模型输入提示使用）。
 *
 * - **API agent**：直接请求 provider 的 `/models`（复用 `modelIdTemplate` 生成最终 id），
 *   并与设置里手填的 `models` 合并（手填项在前，大小写不敏感去重）。
 *   请求失败或返回空列表时，依次回退到手填列表、该 agent 的历史会话缓存。
 * - **stdio/ACP agent**：模型只能通过拉起 agent 会话获得，代价高；
 *   因此按 `updatedAt` 取最近一次带模型快照的会话记录。
 *
 * 这里只产出输入框的候选项，失败一律返回空数组，不向调用方抛错。
 */
import type { AgentInfo, ApiAgentInfo, ModelInfo } from "../../shared/schema";
import { applyModelIdTemplate } from "../../shared/model-id";
import { storageOps } from "../storage";

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_MODELS = 500;

type CacheEntry = { models: ModelInfo[]; fetchedAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ModelInfo[]>>();

export function listAgentModels(agentId: string): Promise<ModelInfo[]> {
  const cached = cache.get(agentId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cached.models);
  }
  const pending = inflight.get(agentId);
  if (pending) return pending;

  const request = loadAgentModels(agentId)
    .catch((error) => {
      console.warn(`[model-catalog] Failed to load models for "${agentId}":`, error);
      return [] as ModelInfo[];
    })
    .then((models) => {
      cache.set(agentId, { models, fetchedAt: Date.now() });
      return models;
    })
    .finally(() => {
      inflight.delete(agentId);
    });

  inflight.set(agentId, request);
  return request;
}

async function loadAgentModels(agentId: string): Promise<ModelInfo[]> {
  const agent = storageOps
    .getSettings()
    .agents.find((candidate: AgentInfo) => candidate.id === agentId);
  if (!agent) return [];

  if (agent.type === "api") {
    // 手填列表是运行时唯一认的模型集合（ApiAgent 优先用它校验 setModel），
    // 因此排在最前；/models 只用来补充接口上其它可用的 id。
    const configured = toModelInfosFromIds(agent.models);
    try {
      const fetched = await fetchApiModels(agent);
      if (fetched.length > 0) return mergeModels(configured, fetched);
    } catch (error) {
      console.warn(
        `[model-catalog] /models request failed for "${agentId}", falling back to configured/session models:`,
        error,
      );
    }
    if (configured.length > 0) return configured;
  }

  return sessionCachedModels(agentId);
}

function toModelInfosFromIds(ids: string[] | undefined): ModelInfo[] {
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  for (const raw of ids ?? []) {
    const modelId = raw.trim();
    const key = modelId.toLowerCase();
    if (!modelId || seen.has(key)) continue;
    seen.add(key);
    models.push({ modelId, name: modelId });
  }
  return models;
}

function mergeModels(primary: ModelInfo[], secondary: ModelInfo[]): ModelInfo[] {
  const seen = new Set(primary.map((model) => model.modelId.toLowerCase()));
  const merged = [...primary];
  for (const model of secondary) {
    const key = model.modelId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(model);
    if (merged.length >= MAX_MODELS) break;
  }
  return merged;
}

async function fetchApiModels(agent: ApiAgentInfo): Promise<ModelInfo[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${agent.baseUrl.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${agent.apiKey}`,
        "Content-Type": "application/json",
        ...(agent.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`List models failed: ${response.status} ${response.statusText}`);
    }
    const payload: unknown = await response.json();
    return toModelInfos(payload, agent.modelIdTemplate);
  } finally {
    clearTimeout(timer);
  }
}

/** 按 `updatedAt` 从新到旧，取第一条带模型快照的会话（快照由 `/models` 或 agent 自己提供）。 */
function sessionCachedModels(agentId: string): ModelInfo[] {
  const sessions = storageOps
    .listSessions()
    .filter((session) => session.agentId === agentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  for (const session of sessions) {
    const models = session.models?.availableModels ?? [];
    if (models.length > 0) {
      return models.map((model) => ({ ...model }));
    }
  }
  return [];
}

function toModelInfos(payload: unknown, modelIdTemplate: string | undefined): ModelInfo[] {
  const seen = new Set<string>();
  const models: ModelInfo[] = [];

  for (const item of readEntries(payload)) {
    const rawId = typeof item.id === "string" ? item.id.trim() : "";
    if (!rawId) continue;

    const modelId = modelIdTemplate ? applyModelIdTemplate(modelIdTemplate, item).trim() : rawId;
    if (!modelId || seen.has(modelId)) continue;

    seen.add(modelId);
    models.push({ modelId, name: modelId });
    if (models.length >= MAX_MODELS) break;
  }

  return models;
}

/** 兼容 `{ data: [...] }`（OpenAI 风格）与裸数组两种返回体。 */
function readEntries(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data.filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
