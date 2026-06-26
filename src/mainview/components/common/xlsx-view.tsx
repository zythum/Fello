import { useEffect, useState } from "react";
import { XlsxViewer } from "@silurus/ooxml/xlsx";
import { useTranslation } from "react-i18next";

export interface XlsxViewProps {
  data: ArrayBuffer;
  filename?: string;
}

export function XlsxView({ data }: XlsxViewProps) {
  const { t } = useTranslation();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!container) return;
    let destroy = false;
    setError(null);
    setLoading(true);
    const viewer = new XlsxViewer(container);
    viewer
      .load(data.slice(0))
      .then(() => {
        if (!destroy) {
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!destroy) {
          setError(err.message || "Failed to load spreadsheet");
          setLoading(false);
        }
      });

    return () => {
      destroy = true;
      viewer.destroy();
      setError(null);
      setLoading(true);
    };
  }, [data, container]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t("fileDetail.loadError", "Failed to load spreadsheet")}: {error}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {t("fileDetail.loading")}
        </div>
      )}
      <div
        ref={setContainer}
        className="w-full h-full"
        aria-label={t("fileDetail.xlsxPreview", "Spreadsheet preview")}
      />
    </div>
  );
}
