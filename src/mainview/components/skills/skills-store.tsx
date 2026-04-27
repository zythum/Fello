import { useTranslation } from "react-i18next";
import { PackageSearch } from "lucide-react";

export function SkillsStore() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 relative h-full">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <PackageSearch className="size-8 text-primary" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("skills.storeTitle")}</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("skills.storeDesc")}</p>
      </div>
    </div>
  );
}
