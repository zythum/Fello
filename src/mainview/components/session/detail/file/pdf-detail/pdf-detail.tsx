import { PdfView } from "../../../../common/pdf-view";
import { LoadingState, ErrorState } from "../common/loading-state";
import { useFile } from "../common/use-file";

interface PdfDetailProps {
  projectId: string;
  file: string;
}

export function PdfDetail({ projectId, file }: PdfDetailProps) {
  const { arrayBuffer, loading, errorMsg } = useFile(projectId, file, { encoding: "base64" });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return (
    <div className="h-full">
      <PdfView data={arrayBuffer} filename={file} />
    </div>
  );
}
