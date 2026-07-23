import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { z } from "zod";
import type { ImageGenerationProviderInfo, ApiAgentInfo } from "../../../../shared/schema";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Plus, Pencil, Trash2, Ellipsis } from "lucide-react";
import { extractErrorMessage, generateUUID } from "@/lib/utils";
import { useMessage } from "../../providers/message";

// ── Dialog form schema ───────────────────────────────────────────────

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

function isValidJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    return true;
  } catch {
    return false;
  }
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed);
}

const schema = z.object({
  name: z.string().trim().min(1, "settings.imageGeneration.validation.enterName"),
  provider: z.string().min(1, "settings.imageGeneration.validation.selectProvider"),
  baseUrl: z.string().trim().min(1, "settings.imageGeneration.validation.enterBaseUrl"),
  apiKey: z.string().trim().min(1, "settings.imageGeneration.validation.enterApiKey"),
  headersRaw: z.string().refine(isValidStringMap, "settings.imageGeneration.validation.jsonObject"),
  extraBodyRaw: z.string().refine(isValidJson, "settings.imageGeneration.validation.jsonObject"),
  model: z.string().trim().min(1, "settings.imageGeneration.validation.enterModel"),
});

type FormValues = z.input<typeof schema>;

// ── Dialog component ─────────────────────────────────────────────────

interface ImageGenerationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProvider: ImageGenerationProviderInfo | null;
  onSave: (provider: ImageGenerationProviderInfo) => Promise<void> | void;
}

function ImageGenerationDialog({
  open,
  onOpenChange,
  initialProvider,
  onSave,
}: ImageGenerationDialogProps) {
  const { t } = useTranslation();
  const { configuredAgents } = useAppStore();
  const apiAgents = configuredAgents.filter((a): a is ApiAgentInfo => a.type === "api");

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(schema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      provider: "openai-compatible",
      baseUrl: "",
      apiKey: "",
      headersRaw: "",
      extraBodyRaw: "",
      model: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: initialProvider?.name ?? "",
      provider: initialProvider?.provider ?? "openai-compatible",
      baseUrl: initialProvider?.baseUrl ?? "",
      apiKey: initialProvider?.apiKey ?? "",
      headersRaw:
        initialProvider && Object.keys(initialProvider.headers || {}).length > 0
          ? JSON.stringify(initialProvider.headers)
          : "",
      extraBodyRaw:
        initialProvider?.extraBody && Object.keys(initialProvider.extraBody).length > 0
          ? JSON.stringify(initialProvider.extraBody, null, 2)
          : "",
      model: initialProvider?.model ?? "",
    });
  }, [initialProvider, open, form]);

  const onSubmit = async (data: FormValues) => {
    await onSave({
      id: initialProvider?.id ?? generateUUID().replace(/-/g, "").slice(0, 12),
      name: data.name.trim(),
      provider: data.provider as "openai-compatible",
      baseUrl: data.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: data.apiKey.trim(),
      headers: parseStringMap(data.headersRaw),
      extraBody: parseJson(data.extraBodyRaw),
      model: data.model.trim(),
      active: initialProvider?.active ?? false,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialProvider
              ? t("settings.imageGeneration.editProvider", "Edit Provider")
              : t("settings.imageGeneration.addProvider", "Add Provider")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.imageGeneration.dialogDesc",
              "Configure the image generation provider with an OpenAI-compatible API.",
            )}
          </DialogDescription>
        </DialogHeader>

        <form id="form-image-generation" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="py-2">
            <div className="grid grid-cols-2 gap-3">
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="ig-name" className="text-[11px] text-muted-foreground">
                      {t("settings.imageGeneration.form.name", "Name")}
                    </FieldLabel>
                    <Input
                      {...field}
                      id="ig-name"
                      placeholder="e.g. OpenAI GPT-Image"
                      aria-invalid={fieldState.invalid}
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
                    <FieldLabel htmlFor="ig-provider" className="text-[11px] text-muted-foreground">
                      {t("settings.imageGeneration.form.provider", "Provider")}
                    </FieldLabel>
                    <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="ig-provider"
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
                  <FieldLabel htmlFor="ig-baseurl" className="text-[11px] text-muted-foreground">
                    {t("settings.imageGeneration.form.baseUrl", "Base URL")}
                  </FieldLabel>
                  <div className="flex items-center gap-1">
                    <Input
                      {...field}
                      id="ig-baseurl"
                      placeholder="e.g. https://api.openai.com/v1"
                      aria-invalid={fieldState.invalid}
                      className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                    />
                    {apiAgents.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-8 shrink-0"
                            />
                          }
                        >
                          <Ellipsis className="size-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-full">
                          {apiAgents.map((agent) => (
                            <DropdownMenuItem
                              key={agent.id}
                              onClick={() => {
                                form.setValue("baseUrl", agent.baseUrl);
                                form.setValue("apiKey", agent.apiKey);
                              }}
                            >
                              <span className="text-[10px] text-muted-foreground font-mono pr-3">
                                {agent.baseUrl}
                              </span>
                              <span className="truncate text-[10px] ml-auto text-muted-foreground/60">
                                {agent.id}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {t(
                      "settings.imageGeneration.form.baseUrlHint",
                      "Request → {baseUrl}/images/generations",
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
              name="apiKey"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="ig-apikey" className="text-[11px] text-muted-foreground">
                    {t("settings.imageGeneration.form.apiKey", "API Key")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="ig-apikey"
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
                  <FieldLabel htmlFor="ig-headers" className="text-[11px] text-muted-foreground">
                    {t("settings.imageGeneration.form.headers", "Headers (JSON)")}
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="ig-headers"
                    placeholder='{ "X-Organization-Id": "org-xxx" }'
                    aria-invalid={fieldState.invalid}
                    className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
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
              name="extraBodyRaw"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="ig-extra-body" className="text-[11px] text-muted-foreground">
                    {t("settings.imageGeneration.form.extraBody", "Extra Body (JSON)")}
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="ig-extra-body"
                    placeholder='{ "quality": "hd", "watermark_enabled": false }'
                    aria-invalid={fieldState.invalid}
                    className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {t(
                      "settings.imageGeneration.form.extraBodyHint",
                      "Additional parameters merged into request body (e.g. quality, style).",
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
              name="model"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="ig-model" className="text-[11px] text-muted-foreground">
                    {t("settings.imageGeneration.form.model", "Model")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="ig-model"
                    placeholder="e.g. gpt-image-2, dall-e-3"
                    aria-invalid={fieldState.invalid}
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
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {t("settings.imageGeneration.cancel", "Cancel")}
          </Button>
          <Button type="submit" form="form-image-generation" size="sm" className="h-7 text-xs">
            {t("settings.imageGeneration.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main settings page ───────────────────────────────────────────────

export function SettingsImageGeneration() {
  const { t } = useTranslation();
  const { imageGeneration, setImageGeneration } = useAppStore();
  const { toast, confirm } = useMessage();
  const [providers, setProviders] = useState<ImageGenerationProviderInfo[]>([]);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogItem, setDialogItem] = useState<ImageGenerationProviderInfo | null>(null);

  useEffect(() => {
    setProviders(imageGeneration);
  }, [imageGeneration]);

  const handleSave = async (updated: ImageGenerationProviderInfo[]) => {
    try {
      await request.updateSettings({ imageGeneration: updated });
      setImageGeneration(updated);
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.imageGeneration.updateFailed", "Failed to update configuration."),
      );
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setDialogItem(null);
  };

  const openAddDialog = () => {
    setDialogItem(null);
    setDialogOpen(true);
  };

  const openEditDialog = (provider: ImageGenerationProviderInfo) => {
    setDialogItem(provider);
    setDialogOpen(true);
  };

  const upsertProvider = async (next: ImageGenerationProviderInfo) => {
    const isNew = dialogItem === null;
    // If first provider, auto-activate
    if (isNew && providers.length === 0) {
      next = { ...next, active: true };
    }
    const updated = isNew
      ? [...providers, next]
      : providers.map((p) => (p.id === dialogItem!.id ? next : p));
    setProviders(updated);
    closeDialog();
    await handleSave(updated);
  };

  const handleDelete = async (id: string) => {
    const result = await confirm({
      title: t("settings.imageGeneration.confirmDeleteTitle", "Delete Provider"),
      content: t(
        "settings.imageGeneration.confirmDeleteDesc",
        "Are you sure you want to delete this image generation provider?",
      ),
      buttons: [
        { text: t("message.cancel", "Cancel"), value: null, variant: "outline" },
        {
          text: t("settings.imageGeneration.delete", "Delete"),
          value: "confirm",
          variant: "destructive",
        },
      ],
    });
    if (!result) return;
    const updated = providers.filter((p) => p.id !== id);
    setProviders(updated);
    await handleSave(updated);
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    // Only one can be active at a time
    const updated = providers.map((p) => ({
      ...p,
      active: p.id === id ? active : false,
    }));
    setProviders(updated);
    await handleSave(updated);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-5 py-4 w-full max-w-4xl mx-auto">
        <h3 className="text-lg font-medium">
          {t("settings.imageGeneration.title", "Image Generation")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(
            "settings.imageGeneration.desc",
            "Configure image generation providers. The active provider will be available as a tool for agents.",
          )}
        </p>
      </div>

      <div className="space-y-2 px-4 w-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between p-1">
          <h3 className="text-xs text-foreground/50">
            {t("settings.imageGeneration.providers", "Providers")}
          </h3>
          <Button
            variant="outline"
            size="xs"
            onClick={openAddDialog}
            className="h-7 text-xs text-foreground/70"
          >
            <Plus className="mr-1 size-3" />
            {t("settings.imageGeneration.add", "Add Provider")}
          </Button>
        </div>
        <div className="border-t border-border -mx-4"></div>
      </div>

      <ScrollArea className="flex-1 w-full overflow-hidden">
        <div className="w-full max-w-4xl mx-auto">
          <div className="space-y-3 m-5 pb-6">
            {providers.map((provider) => (
              <ContextMenu
                key={provider.id}
                onOpenChange={(open) => setContextMenuId(open ? provider.id : null)}
              >
                <ContextMenuTrigger>
                  <div
                    className={`flex items-center gap-2 rounded-lg border p-1.5 min-h-10 text-sm bg-secondary/50 cursor-default select-none overflow-hidden ${contextMenuId === provider.id ? "ring-1 ring-primary" : ""}`}
                  >
                    <span
                      className={`font-bold text-xs ml-1 truncate shrink-0 max-w-32 select-none ${!provider.active ? "text-muted-foreground/50" : ""}`}
                    >
                      {provider.name}
                    </span>
                    <span className="text-[9px] shrink-0 px-1 py-0.5 rounded bg-muted text-muted-foreground/70 uppercase font-medium">
                      {provider.model}
                    </span>
                    <span className="text-[10px] flex-1 w-0 text-muted-foreground font-mono truncate">
                      {provider.baseUrl}
                    </span>
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <Switch
                        size="sm"
                        checked={provider.active}
                        onCheckedChange={(checked) => handleToggleActive(provider.id, checked)}
                      />
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-32">
                  <ContextMenuItem onClick={() => openEditDialog(provider)}>
                    <Pencil className="size-3" />
                    {t("settings.imageGeneration.edit", "Edit")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => handleDelete(provider.id)}>
                    <Trash2 className="size-3" />
                    {t("settings.imageGeneration.delete", "Delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
            {providers.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("settings.imageGeneration.empty", "No image generation providers configured")}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <ImageGenerationDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
          else setDialogOpen(open);
        }}
        initialProvider={dialogItem}
        onSave={upsertProvider}
      />
    </div>
  );
}
