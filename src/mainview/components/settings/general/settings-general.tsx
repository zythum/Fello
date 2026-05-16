import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMessage } from "../../providers/message";

export function SettingsGeneral() {
  const { t, i18n: _i18n } = useTranslation();
  const { theme, setTheme, i18n, setI18n } = useAppStore();
  const { toast } = useMessage();

  const handleThemeChange = async (mode: string | null) => {
    if (!mode) return;
    const newTheme = { themeMode: mode as "light" | "dark" | "system" };
    setTheme(newTheme);
    try {
      await request.updateSettings({
        theme: newTheme,
      });
    } catch {
      toast.error(t("settings.general.saveThemeFailed", "Failed to save theme setting."));
    }
  };

  const handleLanguageChange = async (lang: string | null) => {
    if (!lang) return;
    setI18n({ language: lang });
    _i18n.changeLanguage(lang);
    try {
      await request.updateSettings({
        i18n: {
          language: lang,
        },
      });
    } catch {
      toast.error(t("settings.general.saveLanguageFailed", "Failed to save language setting."));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="space-y-6 px-5 py-4 w-full max-w-4xl mx-auto">
          <div>
            <h3 className="text-lg font-medium">{t("settings.general.title", "General")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("settings.general.desc", "Manage your application's appearance and language.")}
            </p>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium leading-none">
                  {t("settings.general.theme")}
                </label>
                <span className="text-xs text-muted-foreground">
                  {t("settings.themeDesc", "Customize the appearance of the application")}
                </span>
              </div>
              {(() => {
                const themeItems = [
                  { value: "light", label: t("settings.general.light") },
                  { value: "dark", label: t("settings.general.dark") },
                  { value: "system", label: t("settings.general.system") },
                ];
                return (
                  <Select
                    items={themeItems}
                    value={theme.themeMode}
                    onValueChange={handleThemeChange}
                  >
                    <SelectTrigger size="sm" className="w-35">
                      <SelectValue placeholder="Theme" />
                    </SelectTrigger>
                    <SelectContent>
                      {themeItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium leading-none">
                  {t("settings.general.language")}
                </label>
                <span className="text-xs text-muted-foreground">
                  {t("settings.languageDesc", "Select the display language")}
                </span>
              </div>
              {(() => {
                const languageItems = [
                  { value: "en", label: t("settings.general.english") },
                  { value: "zh-CN", label: t("settings.general.chinese") },
                ];
                return (
                  <Select
                    items={languageItems}
                    value={i18n.language}
                    onValueChange={handleLanguageChange}
                  >
                    <SelectTrigger size="sm" className="w-35">
                      <SelectValue placeholder="Language" />
                    </SelectTrigger>
                    <SelectContent>
                      {languageItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
