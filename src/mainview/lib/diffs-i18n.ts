import { i18n as diffsI18n, type DiffsMessages } from "@pierre/diffs";
import i18n from "../i18n";

/**
 * @pierre/diffs 1.7 起把组件内文案收进包级 i18n store（默认英文）。
 * 这里让它跟随应用语言，避免中文界面里出现英文按钮与分隔文本。
 */
const ZH_CN_MESSAGES = {
  unmodifiedLines: "{count, plural, other {# 行未修改}}",
  unknownUnmodifiedLines: "可能还有更多未修改内容",
  expandAll: "展开全部",
  expandLine: "显示完整行",
  noNewlineAtEndOfFile: "文件末尾无换行符",
} satisfies Partial<DiffsMessages>;

function syncDiffsI18n(language: string = i18n.language): void {
  const isZh = language.startsWith("zh");
  diffsI18n.set({
    locale: isZh ? "zh-CN" : "en",
    messages: isZh ? ZH_CN_MESSAGES : undefined,
  });
}

syncDiffsI18n();
i18n.on("languageChanged", syncDiffsI18n);
