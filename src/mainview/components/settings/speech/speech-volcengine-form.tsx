import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SpeechCommonFields } from "./speech-common-fields";
import { OptionalLabel, SpeechSection } from "./speech-form-section";
import {
  speechVolcengineDefaultValues,
  speechVolcengineFromProvider,
  speechVolcengineSchema,
  speechVolcengineToDraft,
  type SpeechProviderFormProps,
  type SpeechVolcengineFormValues,
} from "./speech-form";

/** Volcengine（火山引擎）表单：左列 = 名称/服务商 + 共享凭据，右列 = 识别 / 合成。 */
export function SpeechVolcengineForm({
  open,
  initial,
  seededName,
  onSave,
  onProviderChange,
}: SpeechProviderFormProps) {
  const { t } = useTranslation();
  const form = useForm<SpeechVolcengineFormValues>({
    resolver: standardSchemaResolver(speechVolcengineSchema),
    mode: "onTouched",
    defaultValues: speechVolcengineDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ ...speechVolcengineFromProvider(initial), name: seededName });
  }, [open, initial, seededName, form]);

  const renderError = (message?: string) =>
    message ? <FieldError errors={[{ message: t(message, message) }]} /> : null;

  return (
    <FormProvider {...form}>
      <form
        id="form-speech"
        onSubmit={form.handleSubmit((values) => onSave(speechVolcengineToDraft(values)))}
        className="grid grid-cols-2 gap-5 py-2"
      >
        {/* 左：名称 / 服务商 / 共享凭据 */}
        <FieldGroup>
          <SpeechCommonFields onProviderChange={onProviderChange} />
          <Controller
            name="apiKey"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel
                  htmlFor="speech-vol-apikey"
                  className="text-[11px] text-muted-foreground"
                >
                  {t("settings.speech.form.apiKey", "API Key")}
                </FieldLabel>
                <Input
                  {...field}
                  id="speech-vol-apikey"
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
            name="appId"
            control={form.control}
            render={({ field }) => (
              <Field>
                <OptionalLabel htmlFor="speech-vol-appid">
                  {t("settings.speech.form.appId", "App ID")}
                </OptionalLabel>
                <Input {...field} id="speech-vol-appid" className="h-8 text-[11px]! font-mono" />
              </Field>
            )}
          />
          <Controller
            name="baseUrl"
            control={form.control}
            render={({ field }) => (
              <Field>
                <OptionalLabel htmlFor="speech-vol-baseurl">Endpoint</OptionalLabel>
                <Input
                  {...field}
                  id="speech-vol-baseurl"
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
                <OptionalLabel htmlFor="speech-vol-language">
                  {t("settings.speech.form.language", "Language")}
                </OptionalLabel>
                <Input
                  {...field}
                  id="speech-vol-language"
                  className="h-8 text-[11px]! text-foreground/70 focus-visible:ring-0.5"
                />
              </Field>
            )}
          />
        </FieldGroup>

        {/* 右：识别 / 合成 */}
        <FieldGroup>
          <Controller
            name="sttEnabled"
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
              >
                <Controller
                  name="asrResourceId"
                  control={form.control}
                  render={({ field: resourceField }) => (
                    <Field>
                      <OptionalLabel htmlFor="speech-vol-resource-id">Resource ID</OptionalLabel>
                      <Input
                        {...resourceField}
                        id="speech-vol-resource-id"
                        placeholder="volc.seedasr.sauc.duration"
                        className="h-8 text-[11px]! font-mono"
                      />
                    </Field>
                  )}
                />
              </SpeechSection>
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
                        htmlFor="speech-vol-voice"
                        className="text-[11px] text-muted-foreground"
                      >
                        {t("settings.speech.form.voice", "Voice")}
                      </FieldLabel>
                      <Input
                        {...voiceField}
                        id="speech-vol-voice"
                        placeholder="zh_female_wanwanxiaohe_moon_bigtts"
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
