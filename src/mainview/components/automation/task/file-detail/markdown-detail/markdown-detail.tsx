import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StreamMarkdown } from "../../../../common/stream-markdown";
import { CodeView } from "../../../../common/code-view";

type ViewMode = "preview" | "code";

interface MarkdownDetailProps {
  fileName: string;
  content: string;
}

export function MarkdownDetail({ fileName, content }: MarkdownDetailProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

  return (
    <div className="relative h-full overflow-hidden">
      {viewMode === "preview" ? (
        <ScrollArea className="w-full h-full">
          <div className="p-4 max-w-3xl">
            <StreamMarkdown>{content}</StreamMarkdown>
          </div>
        </ScrollArea>
      ) : (
        <ScrollArea className="w-full h-full">
          <CodeView className="min-h-full" content={content} filename={fileName} />
        </ScrollArea>
      )}

      <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center pointer-events-none">
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as ViewMode)}
          className="pointer-events-auto"
        >
          <TabsList className="h-8 border border-border shadow-lg">
            <TabsTrigger value="preview" className="text-xs min-w-18">
              {t("fileDetail.preview", "Preview")}
            </TabsTrigger>
            <TabsTrigger value="code" className="text-xs min-w-18">
              {t("fileDetail.code", "Code")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
