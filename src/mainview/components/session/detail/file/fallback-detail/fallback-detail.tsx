import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Code } from "lucide-react";
import { useAppStore } from "../../../../../store";
import { request, isWebUI } from "../../../../../backend";
import { EDITOR_LABELS } from "../../../../../../shared/constants";
import { electron } from "../../../../../electron";

interface FallbackDetailProps {
  projectId: string;
  file: string;
}

export function FallbackDetail({ projectId, file }: FallbackDetailProps) {
  const { t } = useTranslation();

  const handleRevealInFinder = useCallback(async () => {
    const absPath = await request.getSystemFilePath({ projectId, path: file, isAbsolute: true });
    electron.revealInFinder(absPath);
  }, [projectId, file]);

  const handleOpenInEditor = useCallback(async () => {
    if (isWebUI) return;
    const absPath = await request.getSystemFilePath({ projectId, path: file, isAbsolute: true });
    const editorName = useAppStore.getState().editor.name;
    electron.openInEditor(absPath, editorName);
  }, [projectId, file]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 mt-10">
      <span className="text-sm text-muted-foreground">
        {t("fileDetail.fileFormatNotSupported")}
      </span>
      {!isWebUI && (
        <button
          type="button"
          onClick={handleRevealInFinder}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
        >
          <FolderOpen className="size-3.5" />
          {t("filePanel.revealInFinder")}
        </button>
      )}
      {!isWebUI && (
        <button
          type="button"
          onClick={handleOpenInEditor}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
        >
          <Code className="size-3.5" />
          {t("filePanel.openInEditor", {
            editor: EDITOR_LABELS[useAppStore.getState().editor.name] ?? "Editor",
          })}
        </button>
      )}
    </div>
  );
}
