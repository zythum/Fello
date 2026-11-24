import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookBookmark, Clock, CpuAi, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDiaryPeriod } from "@/lib/diary-format";
import { request } from "../../backend";
import { useAppStore } from "../../store";
import type { AssistantDiary } from "../../../shared/schema";
import { StreamMarkdown } from "../common/stream-markdown";
import { ErrorState, LoadingState } from "../common/loading-state";

/** Diary files start with Dream's YAML frontmatter: runtime metadata, never part of the content. */
const DIARY_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

type DiaryContent = { file: string; content: string; truncated: boolean };

/** The model is stored as a JSON string, so the surrounding quotes are not meaningful. */
function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value.slice(1, -1);
  }
}

/** Splits frontmatter from the Markdown body and keeps the fields worth showing. */
function parseDiary(content: string): { body: string; tags: string[]; model: string | null } {
  const match = DIARY_FRONTMATTER.exec(content);
  if (!match) return { body: content, tags: [], model: null };
  let tagsValue: string | null = null;
  let model: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "tags") tagsValue = value;
    else if (key === "model") model = unquote(value);
  }
  const tags = tagsValue
    ? tagsValue
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  return { body: content.slice(match[0].length), tags, model };
}

/** Period, tags and model, shown as a quiet meta block instead of the raw YAML. */
function DiaryMeta({
  period,
  tags,
  model,
}: {
  period: string;
  tags: string[];
  model: string | null;
}) {
  return (
    <div className="not-prose mb-4 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/70">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" />
          {period}
        </span>
        {model && (
          <>
            <span className="text-border">·</span>
            <span className="inline-flex min-w-0 items-center gap-1">
              <CpuAi className="size-3 shrink-0" />
              <span className="truncate font-mono">{model}</span>
            </span>
          </>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/80"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Diary entry preview in the assistant's detail column, next to the chat. */
export function DiaryDetail({
  assistantId,
  diary,
  timeZone,
  compact,
  onClose,
}: {
  assistantId: string;
  diary: AssistantDiary;
  /** Server time zone, the same one the calendar uses for day labels. */
  timeZone: string;
  compact: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const isMacApp = useAppStore((s) => s.isMacApp);
  const isFullScreen = useAppStore((s) => s.isFullScreen);
  const showMacTrafficLightSpace = compact && isMacApp && !isFullScreen;
  const [entry, setEntry] = useState<DiaryContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void request
      .readAssistantDiary({ assistantId, file: diary.file })
      .then((next) => {
        if (active) setEntry(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [assistantId, diary.file]);

  const parsed = entry ? parseDiary(entry.content) : null;
  const period = formatDiaryPeriod(diary, timeZone, i18n.language);

  return (
    <div className="flex flex-col w-full h-full min-w-0 relative overflow-hidden">
      <div
        className={cn(
          "h-12 shrink-0 border-b border-border flex items-center justify-between gap-2 px-2 bg-background transition-[padding]",
          !compact ? "" : sidebarOpen ? "pl-2.5" : showMacTrafficLightSpace ? "pl-27" : "pl-10",
        )}
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex items-center min-w-0 flex-1">
          <div className="min-w-0 flex items-center gap-1.5">
            <BookBookmark className="size-4 shrink-0 text-muted-foreground/80" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs truncate leading-tight text-foreground/60">
                {diary.title ?? diary.file}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {error ? (
          <ErrorState message={error} />
        ) : !parsed ? (
          <LoadingState />
        ) : (
          <ScrollArea className="w-full h-full">
            <div className="prose prose-sm dark:prose-invert max-w-none p-6 min-h-full bg-background font-sans pb-20">
              <DiaryMeta period={period} tags={parsed.tags} model={parsed.model} />
              <StreamMarkdown>{parsed.body}</StreamMarkdown>
              {entry?.truncated && (
                <p className="mt-4 text-[10px] text-muted-foreground/60">
                  {t("assistant.calendar.diaryTruncated", "Entry truncated")}
                </p>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
