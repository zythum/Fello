import { PptxView } from "../../../../common/pptx-view";
import { LoadingState, ErrorState } from "../common/loading-state";
import { useFile } from "../common/use-file";

interface PptxDetailProps {
  projectId: string;
  file: string;
}

export function PptxDetail({ projectId, file }: PptxDetailProps) {
  const { arrayBuffer, loading, errorMsg, filePath } = useFile(projectId, file, {
    encoding: "base64",
  });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return (
    <div className="h-full">
      <PptxView data={arrayBuffer} filename={filePath} />
    </div>
  );
}
