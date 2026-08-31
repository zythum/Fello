import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SpeechToTextProviderInfo } from "../../../../shared/schema";
import {
  dashscopeDefaultValues,
  dashscopeFromProvider,
  dashscopeSchema,
  dashscopeToProviderPart,
  type DashScopeFormValues,
  type DashScopeProviderPart,
  type ProviderSubmitRef,
} from "./speech-to-text-form";

interface DashScopeFormProps {
  open: boolean;
  initial: SpeechToTextProviderInfo | null;
  submitRef: ProviderSubmitRef;
  submitAll: () => void;
  onValid: (part: DashScopeProviderPart) => void;
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

export function DashScopeForm({ open, initial, submitRef, submitAll, onValid }: DashScopeFormProps) {
  const { t } = useTranslation();
  const form = useForm<DashScopeFormValues>({
    resolver: standardSchemaResolver(dashscopeSchema),
    mode: "onTouched",
    defaultValues: dashscopeDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      initial?.provider === "dashscope" ? dashscopeFromProvider(initial) : dashscopeDefaultValues(),
    );
  }, [open, initial, form]);

  useEffect(() => {
    submitRef.current = form.handleSubmit((values) => onValid(dashscopeToProviderPart(values)));
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
          name="model"
          control={form.control}
          render={({ field }) => (
            <Field>
              <OptionalLabel htmlFor="stt-model">Model</OptionalLabel>
              <Input
                {...field}
                id="stt-model"
                placeholder="fun-asr-flash-8k-realtime"
                className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
              />
            </Field>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <Controller
            name="workspaceId"
            control={form.control}
            render={({ field }) => (
              <Field>
                <OptionalLabel htmlFor="stt-workspace-id">Workspace ID</OptionalLabel>
                <Input {...field} id="stt-workspace-id" className="h-8 text-[11px]!" />
              </Field>
            )}
          />
          <Controller
            name="region"
            control={form.control}
            render={({ field }) => (
              <Field>
                <OptionalLabel htmlFor="stt-region">Region</OptionalLabel>
                <Input
                  {...field}
                  id="stt-region"
                  placeholder="cn-beijing"
                  className="h-8 text-[11px]! font-mono"
                />
              </Field>
            )}
          />
        </div>
        <Controller
          name="workspace"
          control={form.control}
          render={({ field }) => (
            <Field>
              <OptionalLabel htmlFor="stt-workspace">Workspace</OptionalLabel>
              <Input {...field} id="stt-workspace" className="h-8 text-[11px]! font-mono" />
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
