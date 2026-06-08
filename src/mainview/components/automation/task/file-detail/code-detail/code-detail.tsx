import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeView } from "../../../../common/code-view";

interface CodeDetailProps {
  fileName: string;
  content: string;
}

export function CodeDetail({ fileName, content }: CodeDetailProps) {
  const displayContent = useMemo(() => {
    if (fileName.endsWith(".json")) {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
    }
    return content;
  }, [fileName, content]);

  return (
    <ScrollArea className="w-full h-full">
      <CodeView className="min-h-full" content={displayContent} filename={fileName} />
    </ScrollArea>
  );
}
