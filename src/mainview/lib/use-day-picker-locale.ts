import { useTranslation } from "react-i18next";
import { enUS } from "react-day-picker/locale/en-US";
import { zhCN } from "react-day-picker/locale/zh-CN";
import type { DayPickerLocale } from "react-day-picker/locale";

/**
 * App 语言 → react-day-picker locale。
 *
 * DayPicker 默认使用 en-US，不显式传入时星期/月份等标签在中文界面下仍是英文，
 * Calendar 内部用它作为 locale 的默认值。
 */
export function useDayPickerLocale(): DayPickerLocale {
  const { i18n } = useTranslation();
  return i18n.language.startsWith("zh") ? zhCN : enUS;
}
