import { XlsxView } from "../../../../common/xlsx-view";
import { LoadingState, ErrorState } from "../common/loading-state";
import { useFile } from "../common/use-file";

interface XlsxDetailProps {
  projectId: string;
  file: string;
}

export function XlsxDetail({ projectId, file }: XlsxDetailProps) {
  const { arrayBuffer, loading, errorMsg } = useFile(projectId, file, { encoding: "base64" });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return <div className="h-full"><XlsxView data={arrayBuffer} filename={file} /></div>;
}
