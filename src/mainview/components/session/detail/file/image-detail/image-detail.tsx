import { LoadingState, ErrorState } from "../common/loading-state";
import { useFile } from "../common/use-file";
import { ImageView } from "@/components/common/image-view";

interface ImageDetailProps {
  projectId: string;
  file: string;
}

export function ImageDetail({ projectId, file }: ImageDetailProps) {
  const { content, loading, errorMsg } = useFile(projectId, file, { encoding: "base64" });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  const ext = file.split(".").pop()?.toLowerCase() || "";
  let mimeType = ext;
  if (ext === "svg") mimeType = "svg+xml";
  else if (ext === "jpg") mimeType = "jpeg";
  const src = `data:image/${mimeType};base64,${content}`;

  return <ImageView src={src} alt={file} />;
}
