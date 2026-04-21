import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { request } from "../../backend";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SettingsGeneral() {
  const { t, i18n: _i18n } = useTranslation();
  const { theme, setTheme, i18n, setI18n, pushGlobalErrorMessage } = useAppStore();

  const handleThemeChange = async (mode: string | null) => {
    if (!mode) return;
    const newTheme = { themeMode: mode as "light" | "dark" | "system" };
    setTheme(newTheme);
    try {
      await request.updateSettings({
        theme: newTheme,
      });
    } catch {
      pushGlobalErrorMessage(t("sidebar.saveThemeFailed", "Failed to save theme setting."));
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
      pushGlobalErrorMessage(t("sidebar.saveLanguageFailed", "Failed to save language setting."));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t("settings.general.title", "General")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.general.desc", "Manage your application's appearance and language.")}
        </p>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium leading-none">{t("sidebar.theme")}</label>
            <span className="text-xs text-muted-foreground">
              {t("settings.themeDesc", "Customize the appearance of the application")}
            </span>
          </div>
          <Select value={theme.themeMode} onValueChange={handleThemeChange}>
            <SelectTrigger size="sm" className="w-35">
              <SelectValue placeholder="Theme">
                {(value: string) => {
                  if (value === "light") return t("sidebar.light");
                  if (value === "dark") return t("sidebar.dark");
                  if (value === "system") return t("sidebar.system");
                  return value;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">{t("sidebar.light")}</SelectItem>
              <SelectItem value="dark">{t("sidebar.dark")}</SelectItem>
              <SelectItem value="system">{t("sidebar.system")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium leading-none">{t("sidebar.language")}</label>
            <span className="text-xs text-muted-foreground">
              {t("settings.languageDesc", "Select the display language")}
            </span>
          </div>
          <Select value={i18n.language} onValueChange={handleLanguageChange}>
            <SelectTrigger size="sm" className="w-35">
              <SelectValue placeholder="Language">
                {(value: string) => {
                  if (value === "en") return t("sidebar.english");
                  if (value === "zh-CN") return t("sidebar.chinese");
                  return value;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t("sidebar.english")}</SelectItem>
              <SelectItem value="zh-CN">{t("sidebar.chinese")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
