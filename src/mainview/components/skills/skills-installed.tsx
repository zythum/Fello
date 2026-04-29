import { useState, useEffect, useMemo } from "react";
import { request, isWebUI } from "../../backend";
import { electron } from "../../electron";
import { useTranslation } from "react-i18next";
import { useMessage } from "../providers/message";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StreamMarkdown } from "../common/stream-markdown";
import { FolderOpen, Trash2, FileText, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SkillInfo } from "../../../shared/schema";

export function SkillsInstalled() {
  const { t } = useTranslation();
  const { toast, confirm } = useMessage();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [skillContent, setSkillContent] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchSkills = async () => {
    setIsLoading(true);
    try {
      const catalog = await request.getSkillsCatalog({ all: true });
      setSkills(catalog);
    } catch (err: any) {
      toast.error(err.message || t("skills.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  const groups = useMemo(() => {
    const grouped: Record<string, SkillInfo[]> = {
      fello: [],
      agents: [],
      claude: [],
    };
    for (const skill of skills) {
      if (skill.scope === "fello") {
        grouped["fello"].push(skill);
      } else if (skill.scope === "agents") {
        grouped["agents"].push(skill);
      } else if (skill.scope === "claude") {
        grouped["claude"].push(skill);
      }
    }
    return grouped;
  }, [skills]);

  const handleViewSkill = async (skill: SkillInfo) => {
    setSelectedSkill(skill);
    setSkillContent("");
    setIsModalOpen(true);
    try {
      const content = await request.readSkillFile({ skillId: skill.id });
      setSkillContent(content);
    } catch (err: any) {
      setSkillContent(t("skills.loadContentFailed", { message: err.message }));
    }
  };

  const handleUninstall = async (skill: SkillInfo) => {
    const isFello = skill.scope === "fello";
    if (!isFello) return;

    const res = await confirm({
      title: t("skills.uninstallTitle"),
      content: t("skills.uninstallConfirm", { name: skill.name }),
      buttons: [
        { text: t("skills.cancel"), value: "cancel", variant: "outline" },
        { text: t("skills.uninstall"), value: "uninstall", variant: "destructive" },
      ],
    });

    if (res === "uninstall") {
      try {
        await request.uninstallSkill({ skillId: skill.id });
        toast.success(t("skills.uninstalledSuccess", { name: skill.name }));
        fetchSkills();
      } catch (err: any) {
        toast.error(t("skills.uninstallFailed", { message: err.message }));
      }
    }
  };

  const handleReveal = async (skill: SkillInfo) => {
    if (isWebUI) return;
    try {
      const path = await request.getSkillFileSystemFilePath({ skillId: skill.id });
      await electron.revealInFinder(path);
    } catch (err: any) {
      toast.error(t("skills.revealFailed", { message: err.message }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="space-y-6 px-5 py-4 w-full max-w-4xl mx-auto">
          {Object.entries(groups).map(([groupName, groupSkills]) => {
            if (groupSkills.length === 0) return null;
            return (
              <div key={groupName} className="space-y-4">
                <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  {groupName}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xxl:grid-cols-3 gap-4">
                  {groupSkills.map((skill) => {
                    const isFello = skill.scope === "fello";
                    return (
                      <Card key={`${skill.scope}:${skill.id}`} className="flex flex-col">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base truncate" title={skill.name}>
                            {skill.name}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1">
                          <div className="line-clamp-2 text-xs">
                            {skill.description || t("skills.noDescription")}
                          </div>
                        </CardContent>
                        <CardFooter className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleViewSkill(skill)}
                            title={t("skills.viewSkill")}
                          >
                            <FileText className="size-3.5" />
                          </Button>
                          {!isWebUI && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => handleReveal(skill)}
                              title={t("skills.revealInFinder")}
                            >
                              <FolderOpen className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className={
                              isFello
                                ? "size-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                : "size-8 opacity-50 cursor-not-allowed"
                            }
                            disabled={!isFello}
                            onClick={() => handleUninstall(skill)}
                            title={t("skills.uninstall")}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      {skills.length === 0 && (
        <div className="text-center text-muted-foreground text-smp-8 mt-2">
          {t("skills.noSkills")}
        </div>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="h-[80vh] max-w-200! w-[80vw]! p-3 gap-2 flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-sm">{selectedSkill?.name}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 -m-3 mt-0 border-t border-border overflow-hidden">
            <div className="p-4">
              {skillContent ? (
                <StreamMarkdown>{skillContent}</StreamMarkdown>
              ) : (
                <div className="flex justify-center py-10">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
