import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { z } from "zod";
import type { ApiAgentInfo } from "../../../../shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";

function isValidStringMap(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    return Object.values(parsed).every((v) => typeof v === "string");
  } catch {
    return false;
  }
}

function parseStringMap(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

function isValidContextWindow(raw: string): boolean {
  if (!raw.trim()) return true;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1;
}

const schema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "settings.agents.validation.enterId")
    .regex(/^[a-zA-Z0-9_-]+$/, "settings.agents.validation.idFormat"),
  provider: z.string().min(1, "settings.agents.validation.selectProvider"),
  baseUrl: z.string().trim().min(1, "settings.agents.validation.enterBaseUrl"),
  apiKey: z.string().trim().min(1, "settings.agents.validation.enterApiKey"),
  headersRaw: z.string().refine(isValidStringMap, "settings.agents.validation.jsonObject"),
  contextWindowTokens: z
    .string()
    .refine(isValidContextWindow, "settings.agents.validation.positiveInteger"),
  modelIdTemplate: z.string(),
  modelsRaw: z.string(),
});

type FormValues = z.input<typeof schema>;

interface SettingsAgentApiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAgent: ApiAgentInfo | null;
  onSave: (agent: ApiAgentInfo) => Promise<void> | void;
}

export function SettingsAgentApiDialog({
  open,
  onOpenChange,
  initialAgent,
  onSave,
}: SettingsAgentApiDialogProps) {
  const { t } = useTranslation();

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(schema),
    mode: "onTouched",
    defaultValues: {
      id: "",
      provider: "openai-compatible",
      baseUrl: "",
      apiKey: "",
      headersRaw: "",
      contextWindowTokens: "",
      modelIdTemplate: "",
      modelsRaw: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      id: initialAgent?.id ?? "",
      provider: initialAgent?.provider ?? "openai-compatible",
      baseUrl: initialAgent?.baseUrl ?? "",
      apiKey: initialAgent?.apiKey ?? "",
      headersRaw:
        initialAgent && Object.keys(initialAgent.headers || {}).length > 0
          ? JSON.stringify(initialAgent.headers)
          : "",
      contextWindowTokens: initialAgent?.contextWindowTokens?.toString() ?? "",
      modelIdTemplate: initialAgent?.modelIdTemplate ?? "",
      modelsRaw: initialAgent?.models?.join("\n") ?? "",
    });
  }, [initialAgent, open, form]);

  const onSubmit = async (data: FormValues) => {
    const models = data.modelsRaw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    await onSave({
      type: "api",
      disabled: initialAgent?.disabled ?? false,
      id: data.id.trim(),
      provider: data.provider.trim() as ApiAgentInfo["provider"],
      baseUrl: data.baseUrl.trim(),
      apiKey: data.apiKey.trim(),
      headers: parseStringMap(data.headersRaw),
      contextWindowTokens: data.contextWindowTokens.trim()
        ? Number(data.contextWindowTokens)
        : undefined,
      modelIdTemplate: data.modelIdTemplate.trim() || undefined,
      models: models.length > 0 ? models : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {initialAgent?.id
              ? t("settings.agents.editApiAgent", "Edit API Agent")
              : t("settings.agents.addApiAgent", "Add via API Key")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.agents.apiDialogDesc",
              "Configure provider, endpoint and authentication for API agent.",
            )}
          </DialogDescription>
        </DialogHeader>

        <form id="form-api-agent" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid grid-cols-2 gap-5 py-2">
            {/* Left: ID, Provider, Base URL, API Key, Headers, Context Window */}
            <FieldGroup>
              <div className="grid grid-cols-2 gap-3">
                <Controller
                  name="id"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="api-id" className="text-[11px] text-muted-foreground">
                        {t("settings.agents.agentId")}
                      </FieldLabel>
                      <Input
                        {...field}
                        id="api-id"
                        placeholder={t("settings.agents.agentId")}
                        aria-invalid={fieldState.invalid}
                        disabled={!!initialAgent?.id}
                        className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
                      />
                      {fieldState.invalid && (
                        <FieldError
                          errors={[
                            {
                              message: t(
                                fieldState.error?.message ?? "",
                                fieldState.error?.message ?? "",
                              ),
                            },
                          ]}
                        />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  name="provider"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel
                        htmlFor="api-provider"
                        className="text-[11px] text-muted-foreground"
                      >
                        {t("settings.agents.apiProvider", "Provider")}
                      </FieldLabel>
                      <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger
                          id="api-provider"
                          aria-invalid={fieldState.invalid}
                          className="w-full text-[11px]! font-mono"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai-compatible">openai-compatible</SelectItem>
                        </SelectContent>
                      </Select>
                      {fieldState.invalid && (
                        <FieldError
                          errors={[
                            {
                              message: t(
                                fieldState.error?.message ?? "",
                                fieldState.error?.message ?? "",
                              ),
                            },
                          ]}
                        />
                      )}
                    </Field>
                  )}
                />
              </div>

              <Controller
                name="baseUrl"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="api-baseurl" className="text-[11px] text-muted-foreground">
                      {t("settings.agents.apiBaseUrl", "Base URL")}
                    </FieldLabel>
                    <Input
                      {...field}
                      id="api-baseurl"
                      aria-invalid={fieldState.invalid}
                      className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                    />
                    {fieldState.invalid && (
                      <FieldError
                        errors={[
                          {
                            message: t(
                              fieldState.error?.message ?? "",
                              fieldState.error?.message ?? "",
                            ),
                          },
                        ]}
                      />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="apiKey"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="api-key" className="text-[11px] text-muted-foreground">
                      {t("settings.agents.apiKey", "API Key")}
                    </FieldLabel>
                    <Input
                      {...field}
                      id="api-key"
                      type="password"
                      placeholder="sk-..."
                      aria-invalid={fieldState.invalid}
                      className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                    />
                    {fieldState.invalid && (
                      <FieldError
                        errors={[
                          {
                            message: t(
                              fieldState.error?.message ?? "",
                              fieldState.error?.message ?? "",
                            ),
                          },
                        ]}
                      />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="headersRaw"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="api-headers" className="text-[11px] text-muted-foreground">
                      {t("settings.agents.apiHeaders", "Headers (JSON)")}
                    </FieldLabel>
                    <Textarea
                      {...field}
                      id="api-headers"
                      placeholder='{ "name": "value" }'
                      aria-invalid={fieldState.invalid}
                      className="text-[11px]! min-h-14 font-mono text-foreground/70 focus-visible:ring-0.5"
                    />
                    {fieldState.invalid && (
                      <FieldError
                        errors={[
                          {
                            message: t(
                              fieldState.error?.message ?? "",
                              fieldState.error?.message ?? "",
                            ),
                          },
                        ]}
                      />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="contextWindowTokens"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="api-ctx" className="text-[11px] text-muted-foreground">
                      {t("settings.agents.contextWindowTokens", "Context Window (tokens)")}
                    </FieldLabel>
                    <div className="flex items-center gap-1">
                      <Input
                        {...field}
                        id="api-ctx"
                        type="number"
                        min={1}
                        placeholder="128000"
                        aria-invalid={fieldState.invalid}
                        className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-[11px] font-mono text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        onClick={() => field.onChange("1000000")}
                      >
                        1m
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-[11px] font-mono text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        onClick={() => field.onChange("128000")}
                      >
                        128k
                      </Button>
                    </div>
                    {fieldState.invalid && (
                      <FieldError
                        errors={[
                          {
                            message: t(
                              fieldState.error?.message ?? "",
                              fieldState.error?.message ?? "",
                            ),
                          },
                        ]}
                      />
                    )}
                  </Field>
                )}
              />
            </FieldGroup>

            {/* Right: Models, Model Id Template */}
            <FieldGroup>
              <Controller
                name="modelsRaw"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="api-models" className="text-[11px] text-muted-foreground">
                      {t("settings.agents.models", "Models (one per line)")}
                    </FieldLabel>
                    <Textarea
                      {...field}
                      id="api-models"
                      aria-invalid={fieldState.invalid}
                      className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                    />
                    <p className="text-[10px] text-muted-foreground/70">
                      {t(
                        "settings.agents.modelsHint",
                        "Leave empty to auto-fetch from /models endpoint",
                      )}
                    </p>
                    {fieldState.invalid && (
                      <FieldError
                        errors={[
                          {
                            message: t(
                              fieldState.error?.message ?? "",
                              fieldState.error?.message ?? "",
                            ),
                          },
                        ]}
                      />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="modelIdTemplate"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel
                      htmlFor="api-model-template"
                      className="text-[11px] text-muted-foreground"
                    >
                      {t("settings.agents.modelIdTemplate", "Model Id Template")}
                    </FieldLabel>
                    <Input
                      {...field}
                      id="api-model-template"
                      placeholder="{id}"
                      aria-invalid={fieldState.invalid}
                      className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                    />
                    {fieldState.invalid && (
                      <FieldError
                        errors={[
                          {
                            message: t(
                              fieldState.error?.message ?? "",
                              fieldState.error?.message ?? "",
                            ),
                          },
                        ]}
                      />
                    )}
                  </Field>
                )}
              />
            </FieldGroup>
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button type="submit" form="form-api-agent" size="sm" className="h-7 text-xs">
            {t("settings.agents.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
