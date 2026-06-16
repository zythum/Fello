import { XlsxView } from "../../../../common/xlsx-view";
import { useTaskFile } from "../common/use-task-file";
import { LoadingState, ErrorState } from "../common/loading-state";

interface XlsxDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string;
}

export function XlsxDetail({ scheduleId, taskId, fileName }: XlsxDetailProps) {
  const { arrayBuffer, loading, errorMsg } = useTaskFile(scheduleId, taskId, fileName, {
    encoding: "base64",
  });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return (
    <div className="h-full">
      <XlsxView data={arrayBuffer} filename={fileName} />
    </div>
  );
}
