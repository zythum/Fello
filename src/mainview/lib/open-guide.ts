import { electron } from "@/electron";

/**
 * 打开 GitHub 上的使用手册（guides/{lang}/{doc}），语言跟随界面语言。
 * 供各设置页的 User Guide / 使用手册入口共用。
 */
export function openGuide(language: string | undefined, doc: string): void {
  const lang = language?.startsWith("zh") ? "zh-CN" : "en";
  void electron.openInBrowser(`https://github.com/zythum/Fello/blob/master/guides/${lang}/${doc}`);
}
