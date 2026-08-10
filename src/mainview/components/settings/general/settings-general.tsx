import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import { SettingsProxyDialog } from "./settings-proxy-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight } from "lucide-react";
import { useMessage } from "../../providers/message";
import { EDITOR_LABELS } from "../../../../shared/constants";
import * as tiks from "@rexa-developer/tiks";

export function SettingsGeneral() {
  const { t, i18n: _i18n } = useTranslation();
  const {
    theme,
    setTheme,
    i18n,
    setI18n,
    fileWatcher,
    setFileWatcher,
    editor,
    setEditor,
    sound,
    setSound,
    proxy,
  } = useAppStore();
  const { toast } = useMessage();
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);

  const proxySummary = (() => {
    const mode = proxy.mode ?? "off";
    if (mode === "off") return t("settings.general.proxyOff", "Direct");
    if (mode === "system") return t("settings.general.proxySystem", "System");
    const url = proxy.httpProxy || proxy.httpsProxy || "";
    return url ? url : t("settings.proxy.manual", "Manual");
  })();

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

  const handleFileWatcherChange = async (checked: boolean) => {
    const newFileWatcher = { enabled: checked };
    setFileWatcher(newFileWatcher);
    try {
      await request.updateSettings({
        fileWatcher: newFileWatcher,
      });
    } catch {
      toast.error(
        t("settings.general.saveFileWatcherFailed", "Failed to save file watcher setting."),
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="space-y-6 px-5 py-4 w-full max-w-4xl mx-auto">
          <div>
            <h3 className="text-lg font-medium">{t("settings.general.title", "General")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("settings.general.desc", "Manage your application settings.")}
            </p>
          </div>
          <div className="space-y-6">
            {/* ── Appearance ── */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-3">
                {t("settings.general.groupAppearance", "Appearance")}
              </h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium leading-none">
                      {t("settings.general.theme")}
                    </label>
                    <span className="text-xs text-muted-foreground/90">
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
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium leading-none">
                      {t("settings.general.language")}
                    </label>
                    <span className="text-xs text-muted-foreground/90">
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
            <div className="border-t border-border"></div>
            {/* ── Project ── */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-3">
                {t("settings.general.groupProject", "Project")}
              </h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium leading-none">
                      {t("settings.general.autoWatchFiles")}
                    </label>
                    <span className="text-xs text-muted-foreground/90">
                      {t(
                        "settings.general.autoWatchFilesDesc",
                        "Automatically watch project file changes",
                      )}
                    </span>
                  </div>
                  <Switch checked={fileWatcher.enabled} onCheckedChange={handleFileWatcherChange} />
                </div>
              </div>
            </div>
            <div className="border-t border-border"></div>
            {/* ── Network ── */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-3">
                {t("settings.general.groupNetwork", "Network")}
              </h4>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium leading-none">
                    {t("settings.general.proxy", "Network Proxy")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.general.proxyDesc",
                      "Configure the network proxy used by Fello for Node requests, subprocesses and the UI.",
                    )}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-35 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setProxyDialogOpen(true)}
                  title={t("settings.general.proxyEdit", "Edit proxy settings")}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{proxySummary}</span>
                  <ChevronRight className="size-3 shrink-0" />
                </Button>
              </div>
            </div>
            <div className="border-t border-border"></div>
            {/* ── Editor ── */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-3">
                {t("settings.general.groupEditor", "Editor")}
              </h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium leading-none">
                      {t("settings.general.editor", "Open in Editor")}
                    </label>
                    <span className="text-xs text-muted-foreground/90">
                      {t("settings.general.editorDesc", "Choose the editor to open files")}
                    </span>
                  </div>
                  {(() => {
                    const editorItems = Object.keys(EDITOR_LABELS)
                      .sort((a, b) => EDITOR_LABELS[a].localeCompare(EDITOR_LABELS[b]))
                      .map((value) => ({ value: value, label: EDITOR_LABELS[value] }));

                    return (
                      <Select
                        items={editorItems}
                        value={editor.name}
                        onValueChange={async (val: string | null) => {
                          if (!val) return;
                          const newEditor = { name: val };
                          setEditor(newEditor);
                          try {
                            await request.updateSettings({ editor: newEditor });
                          } catch {
                            toast.error(
                              t(
                                "settings.general.saveEditorFailed",
                                "Failed to save editor setting.",
                              ),
                            );
                          }
                        }}
                      >
                        <SelectTrigger size="sm" className="w-44">
                          <SelectValue
                            placeholder={t("settings.general.selectEditor", "Select editor")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {editorItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              <span className="flex items-center gap-2">{item.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                </div>
              </div>
            </div>
            <div className="border-t border-border"></div>
            {/* ── Sound ── */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-3">
                {t("settings.general.groupSound", "Sound")}
              </h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium leading-none">
                      {t("settings.general.soundEnabled", "Sound Effects")}
                    </label>
                    <span className="text-xs text-muted-foreground/90">
                      {t(
                        "settings.general.soundEnabledDesc",
                        "Play sound effects for notifications",
                      )}
                    </span>
                  </div>
                  <Switch
                    checked={!sound.muted}
                    onCheckedChange={async (checked) => {
                      const newSound = { ...sound, muted: !checked };
                      setSound(newSound);
                      if (newSound.muted) {
                        tiks.mute();
                      } else {
                        tiks.unmute();
                      }
                      try {
                        await request.updateSettings({ sound: newSound });
                      } catch {
                        toast.error(
                          t("settings.general.saveSoundFailed", "Failed to save sound setting."),
                        );
                      }
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium leading-none">
                      {t("settings.general.soundVolume", "Volume")}
                    </label>
                    <span className="text-xs text-muted-foreground/90">
                      {t("settings.general.soundVolumeDesc", "Adjust notification volume")}
                    </span>
                  </div>
                  <div className="w-35">
                    <Slider
                      value={[sound.volume]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={async (val) => {
                        const vol = Array.isArray(val) ? val[0] : val;
                        const newSound = { ...sound, volume: vol };
                        setSound(newSound);
                        tiks.setVolume(vol / 100);
                        try {
                          await request.updateSettings({ sound: newSound });
                        } catch {
                          toast.error(
                            t("settings.general.saveSoundFailed", "Failed to save sound setting."),
                          );
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium leading-none">
                      {t("settings.general.soundTheme", "Sound Style")}
                    </label>
                    <span className="text-xs text-muted-foreground/90">
                      {t("settings.general.soundThemeDesc", "Select the sound effect style")}
                    </span>
                  </div>
                  {(() => {
                    const themeItems = [
                      { value: "soft", label: t("settings.general.soundSoft", "Soft") },
                      { value: "crisp", label: t("settings.general.soundCrisp", "Crisp") },
                    ];
                    return (
                      <Select
                        items={themeItems}
                        value={sound.theme}
                        onValueChange={async (val: string | null) => {
                          if (!val) return;
                          const newSound = { ...sound, theme: val as "soft" | "crisp" };
                          setSound(newSound);
                          tiks.setTheme(newSound.theme);
                          try {
                            await request.updateSettings({ sound: newSound });
                          } catch {
                            toast.error(
                              t(
                                "settings.general.saveSoundFailed",
                                "Failed to save sound setting.",
                              ),
                            );
                          }
                        }}
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
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium leading-none">
                      {t("settings.general.soundTest", "Test")}
                    </label>
                    <span className="text-xs text-muted-foreground/90">
                      {t("settings.general.soundTestDesc", "Preview the current sound effect")}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs w-35 text-muted-foreground hover:text-foreground"
                    onClick={() => tiks.success()}
                  >
                    {t("settings.general.soundTestPlay", "Play")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
      <SettingsProxyDialog open={proxyDialogOpen} onOpenChange={setProxyDialogOpen} />
    </div>
  );
}
