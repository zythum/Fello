import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

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
  /** 该方向是否启用（识别 / 合成同名开关） */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 该方向没有额外可配置项（如讯飞识别）时留空，只显示开关。 */
  children?: ReactNode;
}

/**
 * Dialog 内的「识别」/「合成」分节：标题 + 说明 + 启用开关，下方是该方向的字段。
 * 未启用的分节字段仍可填写（方便先存配置后开开关），但校验只要求启用方向必填。
 */
export function SpeechSection({
  title,
  description,
  checked,
  onCheckedChange,
  children,
}: SpeechSectionProps) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium">{title}</div>
          <div className="text-[11px] text-muted-foreground">{description}</div>
        </div>
        <Switch size="sm" checked={checked} onCheckedChange={onCheckedChange} aria-label={title} />
      </div>
      {children ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}
