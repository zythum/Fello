import { useTranslation } from "react-i18next";
import { Controller, useFormContext } from "react-hook-form";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { speechProviderValues, type SpeechProviderId } from "./speech-form";

interface SpeechCommonFieldsProps {
  /**
   * 服务商改选：把此刻的名称一并回传（名称是表单字段，切表单时不该丢）。
   * Dialog 据此换成对应 Provider 的表单，并把名称作为新表单的初值。
   */
  onProviderChange: (provider: SpeechProviderId, name: string) => void;
}

/**
 * 四个 Provider 表单共用的「名称 + 服务商」两栏（放在左列顶部）。
 *
 * 依赖外层的 `<FormProvider {...form}>`：这样四个表单不必各自重复一遍这两个 Controller。
 */
export function SpeechCommonFields({ onProviderChange }: SpeechCommonFieldsProps) {
  const { t } = useTranslation();
  const { control, getValues } = useFormContext<{ name: string; provider: SpeechProviderId }>();

  return (
    <div className="grid grid-cols-2 gap-3">
      <Controller
        name="name"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="speech-name" className="text-[11px] text-muted-foreground">
              {t("settings.speech.form.name", "Name")}
            </FieldLabel>
            <Input
              {...field}
              id="speech-name"
              placeholder="e.g. Qwen"
              aria-invalid={fieldState.invalid}
              className="h-8 text-[11px]! text-foreground/70 focus-visible:ring-0.5"
            />
            {fieldState.error?.message ? (
              <FieldError
                errors={[{ message: t(fieldState.error.message, fieldState.error.message) }]}
              />
            ) : null}
          </Field>
        )}
      />
      <Controller
        name="provider"
        control={control}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="speech-provider" className="text-[11px] text-muted-foreground">
              {t("settings.speech.form.provider", "Provider")}
            </FieldLabel>
            <Select
              name={field.name}
              value={field.value}
              onValueChange={(value) => {
                const provider = value as SpeechProviderId;
                field.onChange(provider);
                onProviderChange(provider, getValues("name"));
              }}
            >
              <SelectTrigger id="speech-provider" className="w-full text-[11px]! font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {speechProviderValues.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />
    </div>
  );
}
