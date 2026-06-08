import { FileText } from "lucide-react";

interface PdfDetailProps {
  fileName: string;
  content: string;
}

export function PdfDetail({ fileName }: PdfDetailProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <FileText className="size-8" />
        <span className="text-xs">{fileName}</span>
      </div>
    </div>
  );
}
