import { useTranslation } from "react-i18next";

export function LoadingState() {
  const { t } = useTranslation();
  return (
    <div className="text-sm text-muted-foreground text-center mt-10">{t("fileDetail.loading")}</div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return <div className="text-sm text-muted-foreground text-center mt-10">{message}</div>;
}
