import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { z } from "zod";
import type { SnippetInfo } from "../../../../shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";

const schema = z.object({
  title: z.string().trim().min(1, "settings.snippets.validation.enterTitle"),
  content: z.string().min(1, "settings.snippets.validation.enterContent"),
});

type FormValues = z.input<typeof schema>;

interface SettingsSnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSnippet: SnippetInfo | null;
  onSave: (snippet: SnippetInfo) => void;
}

export function SettingsSnippetDialog({
  open,
  onOpenChange,
  initialSnippet,
  onSave,
}: SettingsSnippetDialogProps) {
  const { t } = useTranslation();

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(schema),
    mode: "onTouched",
    defaultValues: { title: "", content: "" },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      title: initialSnippet?.title ?? "",
      content: initialSnippet?.content ?? "",
    });
  }, [initialSnippet, open, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      id: initialSnippet?.id ?? "",
      title: data.title.trim(),
      content: data.content,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialSnippet?.id
              ? t("settings.snippets.edit", "Edit Snippet")
              : t("settings.snippets.add", "Add Snippet")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.snippets.dialogDesc", "Configure the snippet title and content.")}
          </DialogDescription>
        </DialogHeader>

        <form id="form-snippet" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="py-2">
            <Controller
              name="title"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="snippet-title" className="text-[11px] text-muted-foreground">
                    {t("settings.snippets.titleLabel", "Title")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="snippet-title"
                    placeholder={t("settings.snippets.titlePlaceholder", "Title")}
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
              name="content"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel
                    htmlFor="snippet-content"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("settings.snippets.contentLabel", "Content")}
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="snippet-content"
                    placeholder={t("settings.snippets.contentPlaceholder", "Content")}
                    aria-invalid={fieldState.invalid}
                    className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5 min-h-24 break-all max-w-full"
                    rows={5}
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
            {t("settings.snippets.cancel", "Cancel")}
          </Button>
          <Button type="submit" form="form-snippet" size="sm" className="h-7 text-xs">
            {t("settings.snippets.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
