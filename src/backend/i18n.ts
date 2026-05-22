import i18next from "i18next";
import { storageOps } from "./storage";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

const SUPPORTED_LANGS = ["en", "zh-CN"] as const;
type SupportedLang = (typeof SUPPORTED_LANGS)[number];

let currentLanguage: SupportedLang = "en";

const instance = i18next.createInstance(
  {
    resources: {
      en: { translation: en },
      "zh-CN": { translation: zhCN },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  },
  (err) => {
    if (err) {
      console.error("[i18n] Failed to initialize backend i18next:", err);
    }
  },
);

/** Get the current language from settings and sync i18next. */
function syncLanguage(): void {
  try {
    const settings = storageOps.getSettings();
    const lang = settings.i18n?.language;
    if (lang && SUPPORTED_LANGS.includes(lang as SupportedLang) && lang !== currentLanguage) {
      currentLanguage = lang as SupportedLang;
      instance.changeLanguage(currentLanguage);
    }
  } catch {
    // storageOps may not be ready yet; use default
  }
}

/** Translate a key with optional interpolation values. */
export function t(key: string, options?: Record<string, unknown>): string {
  syncLanguage();
  return instance.t(key, options);
}

/** Force i18next to use a specific language. Called when settings change at runtime. */
export function setLanguage(lang: string): void {
  if (SUPPORTED_LANGS.includes(lang as SupportedLang)) {
    currentLanguage = lang as SupportedLang;
    instance.changeLanguage(currentLanguage);
  }
}

export default { t, setLanguage };
