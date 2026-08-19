import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ViewMode = "preview" | "code" | "compare" | "edit";

interface FileViewTabsProps {
  viewMode: ViewMode;
  viewModes: ViewMode[];
  onViewModeChange: (mode: ViewMode) => void;
}

export function FileViewTabs({ viewMode, viewModes, onViewModeChange }: FileViewTabsProps) {
  const { t } = useTranslation();

  if (viewModes.length <= 1) return null;

  return (
    <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center pointer-events-none">
      <Tabs
        className="pointer-events-auto"
        value={viewMode}
        onValueChange={(v) => onViewModeChange(v as ViewMode)}
      >
        <TabsList className="h-8 border border-border shadow-lg">
          {viewModes.map((mode) => (
            <TabsTrigger key={mode} value={mode} className="text-xs min-w-18">
              {mode === "preview"
                ? t("fileDetail.preview")
                : mode === "code"
                  ? t("fileDetail.code")
                  : mode === "compare"
                    ? t("fileDetail.compare")
                    : t("fileDetail.edit")}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
