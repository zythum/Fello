import { useTranslation } from "react-i18next";

export interface ImageViewProps {
  src: string;
  filename?: string;
}

export function ImageView({ src, filename }: ImageViewProps) {
  const { t } = useTranslation();
  const alt = filename || t("imageView.fallbackAlt");
  return (
    <div className="flex items-center justify-center min-h-full p-4 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxyZWN0IHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0iI2ZmZiIgLz4KPHBhdGggZD0iTTAgMGgxMHYxMEgwem0xMCAxMGgxMHYxMEgxMHoiIGZpbGw9IiNlZWVlZWUiIC8+Cjwvc3ZnPg==')] dark:bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxyZWN0IHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0iIzIyMiIgLz4KPHBhdGggZD0iTTAgMGgxMHYxMEgwem0xMCAxMGgxMHYxMEgxMHoiIGZpbGw9IiMzMzMiIC8+Cjwvc3ZnPg==')]">
      <img src={src} alt={alt} className="max-w-full shadow-sm" />
    </div>
  );
}
