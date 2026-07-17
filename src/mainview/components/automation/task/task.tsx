import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { request, isWebUI, subscribe } from "../../../backend";
import { electron } from "../../../electron";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { FileDetail } from "./file-detail/file-detail";
import { Panel } from "./file-panel/file-panel";
import { LoaderCircle } from "lucide-react";
import { copyText } from "@/lib/clipboard";

export function Task() {
  const { scheduleId, taskId } = useParams<{ scheduleId: string; taskId: string }>();

  const [taskFiles, setTaskFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadFiles = useCallback(async () => {
    if (!scheduleId || !taskId) return;
    try {
      const files = await request.getTaskFiles({ scheduleId, taskId });
      setTaskFiles(files ?? []);
      const defaultFile =
        (files ?? []).find((f: string) => f.toLowerCase() === ".fello-conversation.json") ??
        (files ?? []).find((f: string) => f.toLowerCase() === "readme.md");
      setSelectedFile(defaultFile ?? null);
    } catch {
      setTaskFiles([]);
    } finally {
      setLoading(false);
    }
  }, [scheduleId, taskId]);

  useEffect(() => {
    setLoading(true);
    void loadFiles();
  }, [loadFiles]);

  // Reload files when this task completes (running → success/error)
  useEffect(() => {
    const handler = (payload: any) => {
      if (
        payload.scheduleId === scheduleId &&
        payload.task?.id === taskId &&
        payload.task.status !== "running"
      ) {
        void loadFiles();
      }
    };
    subscribe.on("task-update", handler);
    return () => subscribe.off("task-update", handler);
  }, [scheduleId, taskId, loadFiles]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ResizablePanelGroup className="h-full">
      <ResizablePanel id="fileDetail">
        <FileDetail
          scheduleId={scheduleId!}
          taskId={taskId!}
          fileName={selectedFile}
          hasTask={true}
          hasFiles={taskFiles.length > 0}
          onCopyPath={async (file) => {
            try {
              await copyText(file);
            } catch {}
          }}
          onCopyAbsolutePath={async (file) => {
            try {
              const abs = await request.getTaskFileSystemPath({
                scheduleId: scheduleId!,
                taskId: taskId!,
                filePath: file,
              });
              await copyText(abs);
            } catch {}
          }}
          onRevealInFinder={async (file) => {
            if (isWebUI) return;
            try {
              const abs = await request.getTaskFileSystemPath({
                scheduleId: scheduleId!,
                taskId: taskId!,
                filePath: file,
              });
              await electron.revealInFinder(abs);
            } catch {}
          }}
        />
      </ResizablePanel>
      <ResizableHandle className="bg-border/70" />
      <ResizablePanel
        id="filePanel"
        groupResizeBehavior="preserve-pixel-size"
        defaultSize={250}
        minSize={250}
        maxSize={400}
      >
        <Panel
          files={taskFiles}
          selectedFile={selectedFile}
          hasTask={true}
          onSelectFile={setSelectedFile}
          onCopyRelativePath={async (file) => {
            try {
              await copyText(file);
            } catch {}
          }}
          onCopyAbsolutePath={async (file) => {
            try {
              const abs = await request.getTaskFileSystemPath({
                scheduleId: scheduleId!,
                taskId: taskId!,
                filePath: file,
              });
              await copyText(abs);
            } catch {}
          }}
          onRevealInFinder={async (file) => {
            if (isWebUI) return;
            try {
              const abs = await request.getTaskFileSystemPath({
                scheduleId: scheduleId!,
                taskId: taskId!,
                filePath: file,
              });
              await electron.revealInFinder(abs);
            } catch {}
          }}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
