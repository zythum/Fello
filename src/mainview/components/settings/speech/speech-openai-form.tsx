import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OPENAI_ASR_MODEL, OPENAI_TTS_VOICE } from "../../../../shared/speech";
import { SpeechCommonFields } from "./speech-common-fields";
import { OptionalLabel, SpeechSection } from "./speech-form-section";
import {
  speechOpenaiDefaultValues,
  speechOpenaiFromProvider,
  speechOpenaiSchema,
  speechOpenaiToDraft,
  type SpeechOpenaiFormValues,
  type SpeechProviderFormProps,
} from "./speech-form";

/** OpenAI 表单：左列 = 名称/服务商 + 共享凭据，右列 = 识别 / 合成。 */
export function SpeechOpenaiForm({
  open,
  initial,
  seededName,
  onSave,
  onProviderChange,
}: SpeechProviderFormProps) {
  const { t } = useTranslation();
  const form = useForm<SpeechOpenaiFormValues>({
    resolver: standardSchemaResolver(speechOpenaiSchema),
    mode: "onTouched",
    defaultValues: speechOpenaiDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ ...speechOpenaiFromProvider(initial), name: seededName });
  }, [open, initial, seededName, form]);

  const renderError = (message?: string) =>
    message ? <FieldError errors={[{ message: t(message, message) }]} /> : null;

  return (
    <FormProvider {...form}>
      <form
        id="form-speech"
        onSubmit={form.handleSubmit((values) => onSave(speechOpenaiToDraft(values)))}
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
                  htmlFor="speech-oi-apikey"
                  className="text-[11px] text-muted-foreground"
                >
                  {t("settings.speech.form.apiKey", "API Key")}
                </FieldLabel>
                <Input
                  {...field}
                  id="speech-oi-apikey"
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
            name="baseUrl"
            control={form.control}
            render={({ field }) => (
              <Field>
                <OptionalLabel htmlFor="speech-oi-baseurl">Base URL</OptionalLabel>
                <Input
                  {...field}
                  id="speech-oi-baseurl"
                  placeholder="https://api.openai.com"
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
                <OptionalLabel htmlFor="speech-oi-language">
                  {t("settings.speech.form.language", "Language")}
                </OptionalLabel>
                <Input
                  {...field}
                  id="speech-oi-language"
                  className="h-8 text-[11px]! text-foreground/70 focus-visible:ring-0.5"
                />
              </Field>
            )}
          />
        </FieldGroup>

        {/* 右：识别 / 合成 */}
        <FieldGroup className="mt-3">
          <SpeechSection
            title={t("settings.speech.form.recognition", "Recognition")}
            description={t(
              "settings.speech.form.recognitionDesc",
              "Realtime speech-to-text for chat voice input.",
            )}
          >
            <Controller
              name="asrModel"
              control={form.control}
              render={({ field: asrField }) => (
                <Field>
                  <OptionalLabel htmlFor="speech-oi-asr-model">Model</OptionalLabel>
                  <Input
                    {...asrField}
                    id="speech-oi-asr-model"
                    placeholder={OPENAI_ASR_MODEL}
                    className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                  />
                </Field>
              )}
            />
          </SpeechSection>

          <SpeechSection
            title={t("settings.speech.form.synthesis", "Synthesis")}
            description={t(
              "settings.speech.form.synthesisDesc",
              "Read agent replies out loud with this voice.",
            )}
          >
            <Controller
              name="ttsModel"
              control={form.control}
              render={({ field: modelField }) => (
                <Field>
                  <OptionalLabel htmlFor="speech-oi-tts-model">Model</OptionalLabel>
                  <Input
                    {...modelField}
                    id="speech-oi-tts-model"
                    placeholder="gpt-4o-mini-tts"
                    className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                  />
                </Field>
              )}
            />
            <Controller
              name="voice"
              control={form.control}
              render={({ field: voiceField, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <OptionalLabel htmlFor="speech-oi-voice">
                    {t("settings.speech.form.voice", "Voice")}
                  </OptionalLabel>
                  <Input
                    {...voiceField}
                    id="speech-oi-voice"
                    placeholder={OPENAI_TTS_VOICE}
                    aria-invalid={fieldState.invalid}
                    className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                  />
                  {renderError(fieldState.error?.message)}
                </Field>
              )}
            />
          </SpeechSection>
        </FieldGroup>
      </form>
    </FormProvider>
  );
}
