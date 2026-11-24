import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileText, FolderOpen, LoaderCircle } from "lucide-react";
import { request, subscribe, type BackendEvents } from "../../../backend";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { FileDetail } from "../../files/detail/file-detail";
import { FilePanel } from "../../files/panel/file-panel";

const CONVERSATION_FILE = ".fello-conversation.json";
const README_FILE = "readme.md";
/** Task metadata is managed by the backend; hide it to avoid accidental edits. */
const TASK_HIDDEN_PATHS = ["task.json"];

interface TaskProject {
  projectId: string;
  cwd: string;
}

function pickDefaultFile(files: string[]): string | null {
  return (
    files.find((file) => file.toLowerCase() === CONVERSATION_FILE) ??
    files.find((file) => file.toLowerCase() === README_FILE) ??
    null
  );
}

/** Empty state shown in the detail column before a file is selected. */
function EmptyPreview({ hasFiles }: { hasFiles: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        {hasFiles ? (
          <FileText className="size-6 text-muted-foreground/60" />
        ) : (
          <FolderOpen className="size-6 text-muted-foreground/60" />
        )}
      </div>
      <p className="text-xs">
        {hasFiles
          ? t("automation.selectFileToPreview", "Select a file to preview")
          : t("automation.noFiles", "No files")}
      </p>
    </div>
  );
}

/**
 * Task detail: the task output directory is exposed as a virtual project, so the
 * shared file panel / file detail work exactly like they do for real projects.
 */
export function Task() {
  const { scheduleId, taskId } = useParams<{ scheduleId: string; taskId: string }>();
  const { t } = useTranslation();
  const [project, setProject] = useState<TaskProject | null>(null);
  const [hasFiles, setHasFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    if (!scheduleId || !taskId) return;
    try {
      const nextProject = await request.getTaskProject({ scheduleId, taskId });
      const entries = await request.readDir({
        projectId: nextProject.projectId,
        relativePath: "",
      });
      setProject(nextProject);
      // task.json is metadata, not a generated artifact; keep it out of the
      // default selection and the "no files" decision (it still shows in the tree).
      const generated = entries.filter((entry) => entry.name !== "task.json");
      setHasFiles(generated.length > 0);
      setSelectedFile(
        pickDefaultFile(generated.filter((entry) => !entry.isFolder).map((entry) => entry.id)),
      );
    } catch {
      setProject(null);
      setHasFiles(false);
      setSelectedFile(null);
    } finally {
      setLoading(false);
    }
  }, [scheduleId, taskId]);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  // Refresh once the task finishes: files may have been created/changed while it ran.
  useEffect(() => {
    if (!scheduleId || !taskId) return;
    const handler = (payload: BackendEvents["task-update"]) => {
      if (payload.scheduleId !== scheduleId || payload.task?.id !== taskId) return;
      if (payload.task.status === "running") return;
      void load();
      setRefreshToken((token) => token + 1);
    };
    subscribe.on("task-update", handler);
    return () => subscribe.off("task-update", handler);
  }, [scheduleId, taskId, load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project || !scheduleId || !taskId) {
    return <EmptyPreview hasFiles={false} />;
  }

  return (
    <ResizablePanelGroup className="h-full">
      <ResizablePanel id="fileDetail">
        {selectedFile ? (
          <FileDetail
            compact={false}
            projectId={project.projectId}
            file={selectedFile}
            showAddToChat={false}
          />
        ) : (
          <EmptyPreview hasFiles={hasFiles} />
        )}
      </ResizablePanel>
      <ResizableHandle className="bg-border/70" />
      <ResizablePanel
        id="filePanel"
        groupResizeBehavior="preserve-pixel-size"
        defaultSize={250}
        minSize={250}
        maxSize={400}
      >
        <FilePanel
          projectId={project.projectId}
          cwd={project.cwd}
          previewFileId={selectedFile}
          onPreviewFile={setSelectedFile}
          refreshToken={refreshToken}
          persistOpenFolders={false}
          emptyHint={t("automation.noFiles", "No files")}
          showAddToChat={false}
          hiddenPaths={TASK_HIDDEN_PATHS}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
