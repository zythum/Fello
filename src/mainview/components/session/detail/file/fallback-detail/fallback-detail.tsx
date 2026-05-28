import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { request, isWebUI } from "../../../../../backend";
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
    </div>
  );
}
