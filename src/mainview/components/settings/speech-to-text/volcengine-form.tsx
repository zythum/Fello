import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SpeechToTextProviderInfo } from "../../../../shared/schema";
import {
  volcengineDefaultValues,
  volcengineFromProvider,
  volcengineSchema,
  volcengineToProviderPart,
  type ProviderSubmitRef,
  type VolcengineFormValues,
  type VolcengineProviderPart,
} from "./speech-to-text-form";

interface VolcengineFormProps {
  open: boolean;
  initial: SpeechToTextProviderInfo | null;
  submitRef: ProviderSubmitRef;
  submitAll: () => void;
  onValid: (part: VolcengineProviderPart) => void;
}

function OptionalLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <FieldLabel htmlFor={htmlFor} className="text-[11px] text-muted-foreground">
      {children}
      {t("settings.speechToText.form.optional", " (optional)")}
    </FieldLabel>
  );
}

export function VolcengineForm({
  open,
  initial,
  submitRef,
  submitAll,
  onValid,
}: VolcengineFormProps) {
  const { t } = useTranslation();
  const form = useForm<VolcengineFormValues>({
    resolver: standardSchemaResolver(volcengineSchema),
    mode: "onTouched",
    defaultValues: volcengineDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      initial?.provider === "volcengine"
        ? volcengineFromProvider(initial)
        : volcengineDefaultValues(),
    );
  }, [open, initial, form]);

  useEffect(() => {
    submitRef.current = form.handleSubmit((values) => onValid(volcengineToProviderPart(values)));
    return () => {
      submitRef.current = null;
    };
  }, [submitRef, form, onValid]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submitAll();
      }}
    >
      <FieldGroup className="py-1">
        <Controller
          name="apiKey"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="stt-apikey" className="text-[11px] text-muted-foreground">
                {t("settings.speechToText.form.apiKey", "API Key")}
              </FieldLabel>
              <Input
                {...field}
                id="stt-apikey"
                type="password"
                placeholder="sk-..."
                aria-invalid={fieldState.invalid}
                className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
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
          name="resourceId"
          control={form.control}
          render={({ field }) => (
            <Field>
              <OptionalLabel htmlFor="stt-resource-id">Resource ID</OptionalLabel>
              <Input
                {...field}
                id="stt-resource-id"
                placeholder="volc.seedasr.sauc.duration"
                className="h-8 text-[11px]! font-mono"
              />
            </Field>
          )}
        />
        <Controller
          name="appId"
          control={form.control}
          render={({ field }) => (
            <Field>
              <OptionalLabel htmlFor="stt-volc-app-id">
                {t("settings.speechToText.form.appId", "App ID")}
              </OptionalLabel>
              <Input {...field} id="stt-volc-app-id" className="h-8 text-[11px]! font-mono" />
            </Field>
          )}
        />
        <Controller
          name="baseUrl"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <OptionalLabel htmlFor="stt-baseurl">Endpoint</OptionalLabel>
              <Input
                {...field}
                id="stt-baseurl"
                placeholder="wss://..."
                aria-invalid={fieldState.invalid}
                className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
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
          name="language"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="stt-language" className="text-[11px] text-muted-foreground">
                {t("settings.speechToText.form.language", "Language (optional)")}
              </FieldLabel>
              <Input
                {...field}
                id="stt-language"
                className="h-8 text-[11px]! text-foreground/70 focus-visible:ring-0.5"
              />
            </Field>
          )}
        />
      </FieldGroup>
    </form>
  );
}
