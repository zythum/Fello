import { DocxView } from "../../../../common/docx-view";
import { useTaskFile } from "../common/use-task-file";
import { LoadingState, ErrorState } from "../common/loading-state";

interface DocxDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string;
}

export function DocxDetail({ scheduleId, taskId, fileName }: DocxDetailProps) {
  const { arrayBuffer, loading, errorMsg } = useTaskFile(scheduleId, taskId, fileName, {
    encoding: "base64",
  });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return (
    <div className="h-full">
      <DocxView data={arrayBuffer} filename={fileName} />
    </div>
  );
}
