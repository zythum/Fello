import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";

export function Welcome() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 relative h-full">
      <div className="absolute left-0 top-0 right-0 h-12" style={{ WebkitAppRegion: "drag" }} />
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <MessageSquare className="size-8 text-primary" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("sessionView.welcomeTitle")}</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {t("sessionView.welcomeDesc")}
        </p>
      </div>
      <span className="text-xs text-muted-foreground/60">{t("sessionView.poweredBy")}</span>
    </div>
  );
}
