import { PptxView } from "../../../../common/pptx-view";
import { useTaskFile } from "../common/use-task-file";
import { LoadingState, ErrorState } from "../common/loading-state";

interface PptxDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string;
}

export function PptxDetail({ scheduleId, taskId, fileName }: PptxDetailProps) {
  const { arrayBuffer, loading, errorMsg } = useTaskFile(scheduleId, taskId, fileName, { encoding: "base64" });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return (
    <div className="h-full">
      <PptxView data={arrayBuffer} filename={fileName} />
    </div>
  );
}
