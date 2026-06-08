import { ImageIcon } from "lucide-react";

interface ImageDetailProps {
  fileName: string;
  content: string;
}

export function ImageDetail({ fileName }: ImageDetailProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <ImageIcon className="size-8" />
        <span className="text-xs">{fileName}</span>
      </div>
    </div>
  );
}
