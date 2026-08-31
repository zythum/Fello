import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import type { SpeechToTextProviderInfo } from "../../../../shared/schema";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Plus, Pencil, Trash2, BookOpen } from "lucide-react";
import { extractErrorMessage, generateUUID } from "@/lib/utils";
import { openGuide } from "@/lib/open-guide";
import { useMessage } from "../../providers/message";
import {
  speechToTextCommonSchema,
  speechToTextProviderValues,
  type ProviderSubmitRef,
  type SpeechToTextCommonValues,
  type SpeechToTextProviderId,
  type SpeechToTextProviderPart,
} from "./speech-to-text-form";
import { DashScopeForm } from "./dashscope-form";
import { VolcengineForm } from "./volcengine-form";
import { OpenAIForm } from "./openai-form";
import { IFlytekForm } from "./iflytek-form";

interface SpeechToTextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProvider: SpeechToTextProviderInfo | null;
  onSave: (provider: SpeechToTextProviderInfo) => Promise<void> | void;
}

function SpeechToTextDialog({
  open,
  onOpenChange,
  initialProvider,
  onSave,
}: SpeechToTextDialogProps) {
  const { t } = useTranslation();
  const commonForm = useForm<SpeechToTextCommonValues>({
    resolver: standardSchemaResolver(speechToTextCommonSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      provider: "dashscope",
    },
  });
  const providerSubmitRef = useRef<ProviderSubmitRef["current"]>(null);

  const selectedProvider = commonForm.watch("provider");

  useEffect(() => {
    if (!open) return;
    commonForm.reset({
      name: initialProvider?.name ?? "",
      provider: initialProvider?.provider ?? "dashscope",
    });
  }, [initialProvider, open, commonForm]);

  const submitAll = () => {
    commonForm.handleSubmit(() => {
      providerSubmitRef.current?.();
    })();
  };

  const saveProvider = async (provider: SpeechToTextProviderId, part: SpeechToTextProviderPart) => {
    await onSave({
      id: initialProvider?.id ?? generateUUID().replace(/-/g, "").slice(0, 12),
      name: commonForm.getValues("name").trim(),
      provider,
      active: initialProvider?.active ?? false,
      ...part,
    });
  };

  const renderError = (message?: string) =>
    message ? <FieldError errors={[{ message: t(message, message) }]} /> : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialProvider
              ? t("settings.speechToText.editProvider", "Edit Provider")
              : t("settings.speechToText.addProvider", "Add Provider")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.speechToText.dialogDesc",
              "Configure provider, endpoint and authentication for realtime speech recognition.",
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          id="form-speech-to-text"
          onSubmit={commonForm.handleSubmit(() => providerSubmitRef.current?.())}
        >
          <FieldGroup className="pt-1">
            <div className="grid grid-cols-2 gap-3">
              <Controller
                name="name"
                control={commonForm.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="stt-name" className="text-[11px] text-muted-foreground">
                      {t("settings.speechToText.form.name", "Name")}
                    </FieldLabel>
                    <Input
                      {...field}
                      id="stt-name"
                      placeholder="e.g. Qwen ASR"
                      aria-invalid={fieldState.invalid}
                      className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
                    />
                    {renderError(fieldState.error?.message)}
                  </Field>
                )}
              />
              <Controller
                name="provider"
                control={commonForm.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel
                      htmlFor="stt-provider"
                      className="text-[11px] text-muted-foreground"
                    >
                      {t("settings.speechToText.form.provider", "Provider")}
                    </FieldLabel>
                    <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="stt-provider"
                        aria-invalid={fieldState.invalid}
                        className="w-full text-[11px]! font-mono"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {speechToTextProviderValues.map((provider) => (
                          <SelectItem key={provider} value={provider}>
                            {provider}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {renderError(fieldState.error?.message)}
                  </Field>
                )}
              />
            </div>
          </FieldGroup>
        </form>

        {selectedProvider === "dashscope" && (
          <DashScopeForm
            open={open}
            initial={initialProvider}
            submitRef={providerSubmitRef}
            submitAll={submitAll}
            onValid={(part) => saveProvider("dashscope", part)}
          />
        )}
        {selectedProvider === "volcengine" && (
          <VolcengineForm
            open={open}
            initial={initialProvider}
            submitRef={providerSubmitRef}
            submitAll={submitAll}
            onValid={(part) => saveProvider("volcengine", part)}
          />
        )}
        {selectedProvider === "openai" && (
          <OpenAIForm
            open={open}
            initial={initialProvider}
            submitRef={providerSubmitRef}
            submitAll={submitAll}
            onValid={(part) => saveProvider("openai", part)}
          />
        )}
        {selectedProvider === "iflytek" && (
          <IFlytekForm
            open={open}
            initial={initialProvider}
            submitRef={providerSubmitRef}
            submitAll={submitAll}
            onValid={(part) => saveProvider("iflytek", part)}
          />
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {t("settings.speechToText.cancel", "Cancel")}
          </Button>
          <Button type="submit" form="form-speech-to-text" size="sm" className="h-7 text-xs">
            {t("settings.speechToText.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsSpeechToText() {
  const { t, i18n } = useTranslation();
  const { speechToText, setSpeechToText } = useAppStore();
  const { toast, confirm } = useMessage();
  const [providers, setProviders] = useState<SpeechToTextProviderInfo[]>([]);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogItem, setDialogItem] = useState<SpeechToTextProviderInfo | null>(null);

  useEffect(() => {
    setProviders(speechToText);
  }, [speechToText]);

  const handleSave = async (updated: SpeechToTextProviderInfo[]) => {
    try {
      await request.updateSettings({ speechToText: updated });
      setSpeechToText(updated);
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.speechToText.updateFailed", "Failed to update configuration."),
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

  const openEditDialog = (provider: SpeechToTextProviderInfo) => {
    setDialogItem(provider);
    setDialogOpen(true);
  };

  const upsertProvider = async (next: SpeechToTextProviderInfo) => {
    const isNew = dialogItem === null;
    if (isNew && providers.length === 0) next = { ...next, active: true };
    const updated = isNew
      ? [...providers, next]
      : providers.map((provider) => (provider.id === dialogItem!.id ? next : provider));
    setProviders(updated);
    closeDialog();
    await handleSave(updated);
  };

  const handleDelete = async (id: string) => {
    const result = await confirm({
      title: t("settings.speechToText.confirmDeleteTitle", "Delete Provider"),
      content: t(
        "settings.speechToText.confirmDeleteDesc",
        "Are you sure you want to delete this speech provider?",
      ),
      buttons: [
        { text: t("message.cancel", "Cancel"), value: null, variant: "outline" },
        {
          text: t("settings.speechToText.delete", "Delete"),
          value: "confirm",
          variant: "destructive",
        },
      ],
    });
    if (!result) return;
    const updated = providers.filter((provider) => provider.id !== id);
    setProviders(updated);
    await handleSave(updated);
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    const updated = providers.map((provider) => ({
      ...provider,
      active: provider.id === id ? active : false,
    }));
    setProviders(updated);
    await handleSave(updated);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-4xl px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">
            {t("settings.speechToText.title", "Speech to Text")}
          </h3>
          <button
            type="button"
            onClick={() => openGuide(i18n.language, "speech-to-text.md")}
            className="inline-flex cursor-default items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookOpen className="size-3.5" />
            {t("settings.speechToText.guide", "User Guide")}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(
            "settings.speechToText.desc",
            "Configure realtime speech recognition providers for chat voice input.",
          )}
        </p>
      </div>

      <div className="mx-auto w-full max-w-4xl space-y-2 px-4">
        <div className="flex items-center justify-between p-1">
          <h3 className="text-xs text-foreground/50">
            {t("settings.speechToText.providers", "Providers")}
          </h3>
          <Button
            variant="outline"
            size="xs"
            onClick={openAddDialog}
            className="h-7 text-xs text-foreground/70"
          >
            <Plus className="mr-1 size-3" />
            {t("settings.speechToText.add", "Add Provider")}
          </Button>
        </div>
        <div className="-mx-4 border-t border-border" />
      </div>

      <ScrollArea className="w-full flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-4xl">
          <div className="m-5 space-y-3 pb-6">
            {providers.map((provider) => (
              <ContextMenu
                key={provider.id}
                onOpenChange={(open) => setContextMenuId(open ? provider.id : null)}
              >
                <ContextMenuTrigger>
                  <div
                    className={`flex min-h-10 cursor-default select-none items-center gap-2 overflow-hidden rounded-lg border bg-secondary/50 p-1.5 text-sm ${contextMenuId === provider.id ? "ring-1 ring-primary" : ""}`}
                  >
                    <span
                      className={`ml-1 max-w-32 shrink-0 truncate text-xs font-bold ${!provider.active ? "text-muted-foreground/50" : ""}`}
                    >
                      {provider.name}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-medium uppercase text-muted-foreground/70">
                      {provider.provider}
                    </span>
                    <span className="w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                      {provider.model || provider.resourceId || provider.baseUrl}
                    </span>
                    <div className="ml-1 flex shrink-0 items-center gap-1">
                      <Switch
                        size="sm"
                        checked={provider.active}
                        onCheckedChange={(active) => handleToggleActive(provider.id, active)}
                      />
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-32">
                  <ContextMenuItem onClick={() => openEditDialog(provider)}>
                    <Pencil className="size-3" />
                    {t("settings.speechToText.edit", "Edit")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => handleDelete(provider.id)}>
                    <Trash2 className="size-3" />
                    {t("settings.speechToText.delete", "Delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
            {providers.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("settings.speechToText.empty", "No speech-to-text providers configured")}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <SpeechToTextDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
          else setDialogOpen(true);
        }}
        initialProvider={dialogItem}
        onSave={upsertProvider}
      />
    </div>
  );
}
