import { PdfView } from "../../../../common/pdf-view";
import { useTaskFile } from "../common/use-task-file";
import { LoadingState, ErrorState } from "../common/loading-state";

interface PdfDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string;
}

export function PdfDetail({ scheduleId, taskId, fileName }: PdfDetailProps) {
  const { arrayBuffer, loading, errorMsg } = useTaskFile(scheduleId, taskId, fileName, { encoding: "base64" });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return (
    <div className="h-full">
      <PdfView data={arrayBuffer} filename={fileName} />
    </div>
  );
}
