import { DocxView } from "../../../../common/docx-view";
import { LoadingState, ErrorState } from "../common/loading-state";
import { useFile } from "../common/use-file";

interface DocxDetailProps {
  projectId: string;
  file: string;
}

export function DocxDetail({ projectId, file }: DocxDetailProps) {
  const { arrayBuffer, loading, errorMsg } = useFile(projectId, file, { encoding: "base64" });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return (
    <div className="h-full">
      <DocxView data={arrayBuffer} filename={file} />
    </div>
  );
}
