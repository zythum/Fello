import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SpeechToTextProviderInfo } from "../../../../shared/schema";
import {
  iflytekDefaultValues,
  iflytekFromProvider,
  iflytekSchema,
  iflytekToProviderPart,
  type IFlytekFormValues,
  type IFlytekProviderPart,
  type ProviderSubmitRef,
} from "./speech-to-text-form";

interface IFlytekFormProps {
  open: boolean;
  initial: SpeechToTextProviderInfo | null;
  submitRef: ProviderSubmitRef;
  submitAll: () => void;
  onValid: (part: IFlytekProviderPart) => void;
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

export function IFlytekForm({ open, initial, submitRef, submitAll, onValid }: IFlytekFormProps) {
  const { t } = useTranslation();
  const form = useForm<IFlytekFormValues>({
    resolver: standardSchemaResolver(iflytekSchema),
    mode: "onTouched",
    defaultValues: iflytekDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      initial?.provider === "iflytek" ? iflytekFromProvider(initial) : iflytekDefaultValues(),
    );
  }, [open, initial, form]);

  useEffect(() => {
    submitRef.current = form.handleSubmit((values) => onValid(iflytekToProviderPart(values)));
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
          name="appId"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="stt-app-id" className="text-[11px] text-muted-foreground">
                {t("settings.speechToText.form.appId", "App ID")}
              </FieldLabel>
              <Input
                {...field}
                id="stt-app-id"
                aria-invalid={fieldState.invalid}
                className="h-8 text-[11px]! font-mono"
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
          name="apiSecret"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="stt-api-secret" className="text-[11px] text-muted-foreground">
                {t("settings.speechToText.form.apiSecret", "API Secret")}
              </FieldLabel>
              <Input
                {...field}
                id="stt-api-secret"
                type="password"
                aria-invalid={fieldState.invalid}
                className="h-8 text-[11px]! font-mono"
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
