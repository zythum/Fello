import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FieldLabel } from "@/components/ui/field";

/** 可选字段标签：主体文案 + 「(optional)」后缀。 */
export function OptionalLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <FieldLabel htmlFor={htmlFor} className="text-[11px] text-muted-foreground">
      {children}
      {t("settings.speech.form.optional", " (optional)")}
    </FieldLabel>
  );
}

interface SpeechSectionProps {
  title: string;
  description: string;
  /** 该方向可配置的字段；某方向没有额外可配置项（如讯飞识别）时留空。 */
  children?: ReactNode;
}

/**
 * Dialog 内的「识别」/「合成」分节：标题 + 说明 + 该方向的字段。
 *
 * **刻意不放启用开关**：某方向是否生效只由列表条目上的开关决定，弹窗只负责配置字段，
 * 因此这里也不需要「启用方向必填」一类的校验 —— 方向字段都可以留空（如音色留空走各家默认）。
 */
export function SpeechSection({ title, description, children }: SpeechSectionProps) {
  return (
    <div className="rounded-lg ring ring-border/60 p-3">
      <div className="min-w-0">
        <div className="text-xs font-medium">{title}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
      {children ? <div className="mt-5 space-y-5">{children}</div> : null}
    </div>
  );
}
