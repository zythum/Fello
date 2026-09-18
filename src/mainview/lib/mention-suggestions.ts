import { useCallback, useRef } from "react";
import { request } from "../backend";
import { useAppStore } from "../store";
import type { SkillInfo } from "../../shared/schema";
import {
  AT_SUGGESTION_MAX,
  mcpServerInfoToSuggestItem,
  searchFileItemToSuggestItem,
  skillInfoToSuggestItem,
  type SearchFileItem,
  type SuggestItem,
} from "./mention-utils";

/**
 * react-mentions 建议数据源的公共实现（chat-input 与 chat-ask-user-dialog 共用）。
 *
 * 统一了两处输入框原先各写一份的行为：
 * - `#` 文件搜索：先回缓存避免闪空列表，再 100ms 防抖请求 + requestId 竞态保护；
 * - `@` 应用：MCP 服务器按 session 启用集合过滤并排序，技能目录本地过滤 + 缓存回显；
 * - 缺少 projectId 时降级（不请求，只回已有缓存）。
 */

/** react-mentions `<Mention data>` 的取值函数签名 */
export type MentionFetcher = (search: string, callback: (data: SuggestItem[]) => void) => void;

/** 建议查询防抖时长（两处输入框统一） */
const SUGGESTION_DEBOUNCE_MS = 100;

/** `#` 文件 / 文件夹补全数据源 */
export function useFileSuggestions(projectId: string | undefined): MentionFetcher {
  const cacheRef = useRef<SearchFileItem[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  return useCallback(
    (search: string, callback: (data: SuggestItem[]) => void) => {
      // 先回缓存，避免每次按键都闪空列表
      callback(cacheRef.current.map((f) => searchFileItemToSuggestItem(f)));
      if (!projectId) return;

      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      const requestId = ++requestIdRef.current;
      timeoutRef.current = setTimeout(() => {
        request
          .searchFiles({ projectId, query: search || undefined })
          .then((results) => {
            if (requestId !== requestIdRef.current) return;
            cacheRef.current = results;
            callback(results.map((f) => searchFileItemToSuggestItem(f)));
          })
          .catch(() => {
            if (requestId !== requestIdRef.current) return;
            cacheRef.current = [];
            callback([]);
          });
      }, SUGGESTION_DEBOUNCE_MS);
    },
    [projectId],
  );
}

/**
 * `@` 应用（技能 / MCP 服务器）补全数据源。
 * `getSkills` 返回最近一次取到的技能目录，供建议面板展示名称与描述（ref 语义，不触发重渲染）。
 */
export function useAtSuggestions({
  projectId,
  mcpServerIds,
}: {
  projectId: string | undefined;
  mcpServerIds: string[];
}): { fetcher: MentionFetcher; getSkills: () => SkillInfo[] } {
  const skillsCacheRef = useRef<SkillInfo[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // 只提示当前 session 启用的 MCP 服务器（fetch 时才读 store，避免订阅整表）
  const collectMcpItems = useCallback(
    (search: string): SuggestItem[] => {
      const lowerSearch = search.toLowerCase();
      return useAppStore
        .getState()
        .configuredMcpServers.filter(
          (m) =>
            mcpServerIds.includes(m.id) &&
            (!lowerSearch ||
              m.id.toLowerCase().includes(lowerSearch) ||
              (m.type === "stdio" && m.command.toLowerCase().includes(lowerSearch)) ||
              (m.type === "http" && m.url.toLowerCase().includes(lowerSearch))),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => mcpServerInfoToSuggestItem(m))
        .slice(0, AT_SUGGESTION_MAX);
    },
    [mcpServerIds],
  );

  const fetcher = useCallback<MentionFetcher>(
    (search: string, callback: (data: SuggestItem[]) => void) => {
      const lowerSearch = (search || "").toLowerCase();
      const mcpItems = collectMcpItems(lowerSearch);

      // 先用缓存里的技能立即回显，避免闪烁
      const cachedSkills = skillsCacheRef.current
        .filter(
          (s) =>
            !lowerSearch ||
            s.name.toLowerCase().includes(lowerSearch) ||
            s.description?.toLowerCase().includes(lowerSearch),
        )
        .map((s) => skillInfoToSuggestItem(s))
        .slice(0, AT_SUGGESTION_MAX);

      callback([...mcpItems, ...cachedSkills]);
      if (!projectId) return;

      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      const requestId = ++requestIdRef.current;
      timeoutRef.current = setTimeout(() => {
        request
          .getSkillsCatalog({ projectId })
          .then((results) => {
            if (requestId !== requestIdRef.current) return;

            const filtered = results
              .filter(
                (s) =>
                  !lowerSearch ||
                  s.name.toLowerCase().includes(lowerSearch) ||
                  s.description?.toLowerCase().includes(lowerSearch),
              )
              .sort((a, b) => a.name.localeCompare(b.name));
            skillsCacheRef.current = filtered;

            callback([
              ...collectMcpItems(lowerSearch),
              ...filtered.map((s) => skillInfoToSuggestItem(s)).slice(0, AT_SUGGESTION_MAX),
            ]);
          })
          .catch(() => {
            if (requestId !== requestIdRef.current) return;
            skillsCacheRef.current = [];
            callback(mcpItems);
          });
      }, SUGGESTION_DEBOUNCE_MS);
    },
    [projectId, collectMcpItems],
  );

  const getSkills = useCallback(() => skillsCacheRef.current, []);

  return { fetcher, getSkills };
}
