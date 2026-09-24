import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SpeechCommonFields } from "./speech-common-fields";
import { OptionalLabel, SpeechSection } from "./speech-form-section";
import {
  speechIflytekDefaultValues,
  speechIflytekFromProvider,
  speechIflytekSchema,
  speechIflytekToDraft,
  type SpeechIflytekFormValues,
  type SpeechProviderFormProps,
} from "./speech-form";

/**
 * IFlytek（讯飞）表单：左列 = 名称/服务商 + 共享凭据（应用三元组），右列 = 识别 / 合成。
 * 识别侧没有额外可配置项（只有开关）。
 */
export function SpeechIflytekForm({
  open,
  initial,
  seededName,
  onSave,
  onProviderChange,
}: SpeechProviderFormProps) {
  const { t } = useTranslation();
  const form = useForm<SpeechIflytekFormValues>({
    resolver: standardSchemaResolver(speechIflytekSchema),
    mode: "onTouched",
    defaultValues: speechIflytekDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ ...speechIflytekFromProvider(initial), name: seededName });
  }, [open, initial, seededName, form]);

  const renderError = (message?: string) =>
    message ? <FieldError errors={[{ message: t(message, message) }]} /> : null;

  return (
    <FormProvider {...form}>
      <form
        id="form-speech"
        onSubmit={form.handleSubmit((values) => onSave(speechIflytekToDraft(values)))}
        className="grid grid-cols-2 gap-5 py-2"
      >
        {/* 左：名称 / 服务商 / 共享凭据 */}
        <FieldGroup>
          <SpeechCommonFields onProviderChange={onProviderChange} />
          <Controller
            name="appId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel
                  htmlFor="speech-xf-appid"
                  className="text-[11px] text-muted-foreground"
                >
                  {t("settings.speech.form.appId", "App ID")}
                </FieldLabel>
                <Input
                  {...field}
                  id="speech-xf-appid"
                  aria-invalid={fieldState.invalid}
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
                {renderError(fieldState.error?.message)}
              </Field>
            )}
          />
          <Controller
            name="apiKey"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel
                  htmlFor="speech-xf-apikey"
                  className="text-[11px] text-muted-foreground"
                >
                  {t("settings.speech.form.apiKey", "API Key")}
                </FieldLabel>
                <Input
                  {...field}
                  id="speech-xf-apikey"
                  type="password"
                  placeholder="sk-..."
                  aria-invalid={fieldState.invalid}
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
                {renderError(fieldState.error?.message)}
              </Field>
            )}
          />
          <Controller
            name="apiSecret"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel
                  htmlFor="speech-xf-api-secret"
                  className="text-[11px] text-muted-foreground"
                >
                  {t("settings.speech.form.apiSecret", "API Secret")}
                </FieldLabel>
                <Input
                  {...field}
                  id="speech-xf-api-secret"
                  type="password"
                  aria-invalid={fieldState.invalid}
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
                {renderError(fieldState.error?.message)}
              </Field>
            )}
          />
          <Controller
            name="baseUrl"
            control={form.control}
            render={({ field }) => (
              <Field>
                <OptionalLabel htmlFor="speech-xf-baseurl">Endpoint</OptionalLabel>
                <Input
                  {...field}
                  id="speech-xf-baseurl"
                  placeholder="wss://..."
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
              </Field>
            )}
          />
          <Controller
            name="language"
            control={form.control}
            render={({ field }) => (
              <Field>
                <OptionalLabel htmlFor="speech-xf-language">
                  {t("settings.speech.form.language", "Language")}
                </OptionalLabel>
                <Input
                  {...field}
                  id="speech-xf-language"
                  className="h-8 text-[11px]! text-foreground/70 focus-visible:ring-0.5"
                />
              </Field>
            )}
          />
        </FieldGroup>

        {/* 右：识别 / 合成 */}
        <FieldGroup>
          <Controller
            name="asrEnabled"
            control={form.control}
            render={({ field }) => (
              <SpeechSection
                title={t("settings.speech.form.recognition", "Recognition")}
                description={t(
                  "settings.speech.form.recognitionDesc",
                  "Realtime speech-to-text for chat voice input.",
                )}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />

          <Controller
            name="ttsEnabled"
            control={form.control}
            render={({ field }) => (
              <SpeechSection
                title={t("settings.speech.form.synthesis", "Synthesis")}
                description={t(
                  "settings.speech.form.synthesisDesc",
                  "Read agent replies out loud with this voice.",
                )}
                checked={field.value}
                onCheckedChange={field.onChange}
              >
                <Controller
                  name="voice"
                  control={form.control}
                  render={({ field: voiceField, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel
                        htmlFor="speech-xf-voice"
                        className="text-[11px] text-muted-foreground"
                      >
                        {t("settings.speech.form.voice", "Voice")}
                      </FieldLabel>
                      <Input
                        {...voiceField}
                        id="speech-xf-voice"
                        placeholder="x4_yezi"
                        aria-invalid={fieldState.invalid}
                        className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                      />
                      {renderError(fieldState.error?.message)}
                    </Field>
                  )}
                />
              </SpeechSection>
            )}
          />
        </FieldGroup>
      </form>
    </FormProvider>
  );
}
