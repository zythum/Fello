import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DASHSCOPE_ASR_MODEL, DASHSCOPE_TTS_VOICE } from "../../../../shared/speech";
import { SpeechCommonFields } from "./speech-common-fields";
import { OptionalLabel, SpeechSection } from "./speech-form-section";
import {
  speechDashscopeDefaultValues,
  speechDashscopeFromProvider,
  speechDashscopeSchema,
  speechDashscopeToDraft,
  type SpeechDashscopeFormValues,
  type SpeechProviderFormProps,
} from "./speech-form";

/**
 * DashScope（通义）表单：左列 = 名称/服务商 + 共享凭据，右列 = 识别 / 合成。
 * 与其它设置弹窗（如 API Agent）保持同一套左右结构。
 */
export function SpeechDashscopeForm({
  open,
  initial,
  seededName,
  onSave,
  onProviderChange,
}: SpeechProviderFormProps) {
  const { t } = useTranslation();
  const form = useForm<SpeechDashscopeFormValues>({
    resolver: standardSchemaResolver(speechDashscopeSchema),
    mode: "onTouched",
    defaultValues: speechDashscopeDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ ...speechDashscopeFromProvider(initial), name: seededName });
  }, [open, initial, seededName, form]);

  const renderError = (message?: string) =>
    message ? <FieldError errors={[{ message: t(message, message) }]} /> : null;

  return (
    <FormProvider {...form}>
      <form
        id="form-speech"
        onSubmit={form.handleSubmit((values) => onSave(speechDashscopeToDraft(values)))}
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
                  htmlFor="speech-ds-apikey"
                  className="text-[11px] text-muted-foreground"
                >
                  {t("settings.speech.form.apiKey", "API Key")}
                </FieldLabel>
                <Input
                  {...field}
                  id="speech-ds-apikey"
                  type="password"
                  placeholder="sk-..."
                  aria-invalid={fieldState.invalid}
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
                {renderError(fieldState.error?.message)}
              </Field>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <Controller
              name="workspaceId"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <OptionalLabel htmlFor="speech-ds-workspace-id">Workspace ID</OptionalLabel>
                  <Input {...field} id="speech-ds-workspace-id" className="h-8 text-[11px]!" />
                </Field>
              )}
            />
            <Controller
              name="region"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <OptionalLabel htmlFor="speech-ds-region">Region</OptionalLabel>
                  <Input
                    {...field}
                    id="speech-ds-region"
                    placeholder="cn-beijing"
                    aria-invalid={fieldState.invalid}
                    className="h-8 text-[11px]! font-mono"
                  />
                  {renderError(fieldState.error?.message)}
                </Field>
              )}
            />
          </div>
          <Controller
            name="workspace"
            control={form.control}
            render={({ field }) => (
              <Field>
                <OptionalLabel htmlFor="speech-ds-workspace">Workspace</OptionalLabel>
                <Input
                  {...field}
                  id="speech-ds-workspace"
                  className="h-8 text-[11px]! font-mono"
                />
              </Field>
            )}
          />
          <Controller
            name="language"
            control={form.control}
            render={({ field }) => (
              <Field>
                <OptionalLabel htmlFor="speech-ds-language">
                  {t("settings.speech.form.language", "Language")}
                </OptionalLabel>
                <Input
                  {...field}
                  id="speech-ds-language"
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
                  <OptionalLabel htmlFor="speech-ds-asr-model">Model</OptionalLabel>
                  <Input
                    {...asrField}
                    id="speech-ds-asr-model"
                    placeholder={DASHSCOPE_ASR_MODEL}
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
                  <OptionalLabel htmlFor="speech-ds-tts-model">Model</OptionalLabel>
                  <Input
                    {...modelField}
                    id="speech-ds-tts-model"
                    placeholder="qwen-audio-3.0-tts-flash"
                    className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                  />
                </Field>
              )}
            />
            <Controller
              name="voice"
              control={form.control}
              render={({ field: voiceField }) => (
                <Field>
                  <OptionalLabel htmlFor="speech-ds-voice">
                    {t("settings.speech.form.voice", "Voice")}
                  </OptionalLabel>
                  <Input
                    {...voiceField}
                    id="speech-ds-voice"
                    placeholder={DASHSCOPE_TTS_VOICE}
                    className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                  />
                </Field>
              )}
            />
          </SpeechSection>
        </FieldGroup>
      </form>
    </FormProvider>
  );
}
