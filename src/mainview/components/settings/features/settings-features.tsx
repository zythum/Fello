import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { extractErrorMessage } from "@/lib/utils";
import { useMessage } from "../../providers/message";
import {
  ALL_FEATURES,
  FEATURE_DESCRIPTION_I18N_KEYS,
  FEATURE_I18N_KEYS,
} from "../../../../shared/constants";
import type { Feature } from "../../../../shared/schema";

export function SettingsFeatures() {
  const { t } = useTranslation();
  const features = useAppStore((state) => state.features);
  const setFeatures = useAppStore((state) => state.setFeatures);
  const { toast } = useMessage();

  const handleToggle = async (feature: Feature, enabled: boolean) => {
    const previous = features;
    const next = enabled ? [...features, feature] : features.filter((item) => item !== feature);
    setFeatures(next);

    try {
      await request.updateSettings({ features: next });
    } catch (error) {
      setFeatures(previous);
      toast.error(
        extractErrorMessage(error) ||
          t("settings.features.updateFailed", "Failed to update feature defaults."),
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-5 py-4 w-full max-w-4xl mx-auto">
        <h3 className="text-lg font-medium">{t("settings.features.title", "Features")}</h3>
        <p className="text-sm text-muted-foreground">
          {t(
            "settings.features.desc",
            "Choose which features are enabled by default for new sessions and automations.",
          )}
        </p>
      </div>

      <ScrollArea className="flex-1 w-full overflow-hidden">
        <div className="w-full max-w-4xl mx-auto">
          <div className="space-y-3 m-5 pb-6">
            {ALL_FEATURES.map((feature) => {
              const checked = features.includes(feature);
              return (
                <div
                  key={feature}
                  className="flex flex-col gap-2 rounded-lg border bg-secondary/50 p-3 cursor-default select-none"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-bold text-xs truncate ${!checked ? "text-muted-foreground/50" : ""}`}
                    >
                      {t(FEATURE_I18N_KEYS[feature], { defaultValue: feature })}
                    </span>
                    <Switch
                      size="sm"
                      checked={checked}
                      onCheckedChange={(enabled) => void handleToggle(feature, enabled)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(FEATURE_DESCRIPTION_I18N_KEYS[feature], { defaultValue: feature })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
