import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Ban } from "lucide-react";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import { electron } from "../../../electron";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Trash2, FolderOpen, ChevronRight } from "lucide-react";
import { extractErrorMessage } from "@/lib/utils";
import { useMessage } from "../../providers/message";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

interface MemoryEntry {
  weight: number;
  text: string;
  date: string;
  tags: string[];
}

interface ProjectMemory {
  projectId: string;
  projectTitle: string;
  entries: MemoryEntry[] | null;
}

export function SettingsMemory() {
  const { t } = useTranslation();
  const projects = useAppStore((s) => s.projects);
  const { toast, confirm } = useMessage();
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const results: ProjectMemory[] = [];
      for (const project of projects) {
        try {
          const data = await request.getMemory({ projectId: project.id });
          results.push({
            projectId: project.id,
            projectTitle: project.title,
            entries: data?.entries ?? null,
          });
        } catch {
          results.push({
            projectId: project.id,
            projectTitle: project.title,
            entries: null,
          });
        }
      }
      results.sort((a, b) => a.projectTitle.localeCompare(b.projectTitle));
      setMemories(results);
    } finally {
      setLoading(false);
    }
  }, [projects]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const handleClear = async (projectId: string, projectTitle: string) => {
    const result = await confirm({
      title: t("settings.memory.confirmClearTitle", "Clear Memory"),
      content: t(
        "settings.memory.confirmClearDesc",
        'Are you sure you want to clear all memory for project "{{title}}"? This cannot be undone.',
        { title: projectTitle },
      ),
      buttons: [
        { text: t("message.cancel", "Cancel"), value: null, variant: "outline" },
        { text: t("settings.memory.clear", "Clear"), value: "confirm", variant: "destructive" },
      ],
    });
    if (!result) return;
    try {
      await request.clearMemory({ projectId });
      await loadMemories();
      toast.success(t("settings.memory.cleared", "Memory cleared."));
    } catch (err) {
      toast.error(
        extractErrorMessage(err) || t("settings.memory.clearFailed", "Failed to clear memory."),
      );
    }
  };

  const handleReveal = async (projectId: string) => {
    try {
      const filePath = await request.getMemorySystemFilePath({ projectId });
      if (filePath) {
        electron.revealInFinder(filePath);
      } else {
        toast.error(t("settings.memory.noFile", "No memory file found."));
      }
    } catch (err) {
      toast.error(
        extractErrorMessage(err) || t("settings.memory.revealFailed", "Failed to reveal file."),
      );
    }
  };

  const weightLabel = (w: number) => {
    if (w >= 3) return "critical";
    if (w >= 2) return "important";
    return "general";
  };

  const weightColor = (w: number) => {
    if (w >= 3) return "text-red-500";
    if (w >= 2) return "text-amber-500";
    return "text-muted-foreground";
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-5 py-4 w-full max-w-4xl mx-auto">
        <h3 className="text-lg font-medium">{t("settings.memory.title", "Memory")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.memory.desc", "View and manage persistent project-level memory.")}
        </p>
      </div>

      <div className="space-y-2 px-4 w-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between p-1">
          <h3 className="text-xs text-foreground/50">
            {t("settings.memory.projectMemories", "Project Memories")}
          </h3>
          <Button
            variant="outline"
            size="xs"
            onClick={loadMemories}
            disabled={loading}
            className="h-7 text-xs text-foreground/70"
          >
            <RefreshCw className={`mr-1 size-3 ${loading ? "animate-spin" : ""}`} />
            {t("settings.memory.refresh", "Refresh")}
          </Button>
        </div>
        <div className="border-t border-border -mx-4"></div>
      </div>

      <ScrollArea className="flex-1 w-full overflow-hidden">
        <div className="w-full max-w-4xl mx-auto">
          <div className="space-y-4 m-5 pb-6">
            {memories.length === 0 && !loading && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("settings.memory.noProjects", "No projects found.")}
              </div>
            )}

            {memories.map((pm) => (
              <div key={pm.projectId} className="border border-border rounded-lg overflow-hidden">
                {/* Project header */}
                <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
                  <span className="text-xs font-medium truncate uppercase text-foreground/80">
                    {pm.projectTitle}
                  </span>
                  <div className="flex items-center gap-1 shrink-0 -mr-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-6 w-6 p-0"
                      onClick={() => handleReveal(pm.projectId)}
                      title={t("settings.memory.revealInFinder", "Reveal in Finder")}
                    >
                      <FolderOpen className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleClear(pm.projectId, pm.projectTitle)}
                      title={t("settings.memory.clear", "Clear")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Entries table */}
                {pm.entries === null || pm.entries.length === 0 ? (
                  <div className="flex gap-3 px-4 py-3 text-xs text-muted-foreground items-center">
                    <div className="w-4 flex items-center justify-center">
                      <Ban className="size-3" />
                    </div>
                    <div className="flex-1">
                      {t("settings.memory.empty", "No memories stored.")}
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    <Collapsible>
                      <CollapsibleTrigger className="w-full flex items-center gap-1.5 px-4 py-2 text-xs text-foreground/50 hover:bg-muted/30 [&[data-panel-open]_svg]:rotate-90">
                        <ChevronRight className="size-3 transition-transform -ml-1" />
                        <span className="font-medium uppercase">
                          {t("settings.memory.entries", "Entries")}
                        </span>
                        <span className="text-muted-foreground/60">({pm.entries.length})</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="divide-y divide-border border-t border-border">
                          {pm.entries.map((entry, idx) => (
                            <div key={idx} className="flex items-start gap-3 px-4 py-2 text-xs">
                              <div
                                className={`w-4 text-center shrink-0 font-mono font-medium ${weightColor(entry.weight)}`}
                                aria-label={weightLabel(entry.weight)}
                              >
                                <span>+{entry.weight}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-foreground/80">{entry.text}</div>
                                <div className="flex mt-2 items-center">
                                  <div className="shrink-0 flex gap-1 flex-1">
                                    {entry.tags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                  <div className="shrink-0 text-muted-foreground/80 text-[10px]">
                                    <span>{entry.date}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
