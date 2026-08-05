import { useMemo } from "react";
import { useTaskFile } from "../common/use-task-file";
import { LoadingState, ErrorState } from "../common/loading-state";
import { ImageView } from "@/components/common/image-view";

interface ImageDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string;
}

export function ImageDetail({ scheduleId, taskId, fileName }: ImageDetailProps) {
  const { content, loading, errorMsg, filePath } = useTaskFile(scheduleId, taskId, fileName, {
    encoding: "base64",
  });

  const src = useMemo(() => {
    if (!content) return "";
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    let mimeType = ext;
    if (ext === "svg") mimeType = "svg+xml";
    else if (ext === "jpg") mimeType = "jpeg";
    return `data:image/${mimeType};base64,${content}`;
  }, [filePath, content]);

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return <ImageView src={src} alt={filePath} />;
}
