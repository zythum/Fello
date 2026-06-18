import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { z } from "zod";
import type { SseMcpServerInfo } from "../../../../shared/schema";
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

const schema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "settings.mcp.validation.enterId")
    .regex(/^[a-zA-Z0-9_-]+$/, "settings.mcp.validation.idFormat"),
  url: z.string().trim().min(1, "settings.mcp.validation.enterUrl"),
  headersRaw: z.string().refine(isValidStringMap, "settings.mcp.validation.jsonObject"),
});

type FormValues = z.input<typeof schema>;

interface SettingsMcpSseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMcp: SseMcpServerInfo | null;
  onSave: (mcp: SseMcpServerInfo) => Promise<void> | void;
}

export function SettingsMcpSseDialog({
  open,
  onOpenChange,
  initialMcp,
  onSave,
}: SettingsMcpSseDialogProps) {
  const { t } = useTranslation();

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(schema),
    mode: "onTouched",
    defaultValues: { id: "", url: "", headersRaw: "" },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      id: initialMcp?.id ?? "",
      url: initialMcp?.url ?? "",
      headersRaw:
        initialMcp && Object.keys(initialMcp.headers || {}).length > 0
          ? JSON.stringify(initialMcp.headers)
          : "",
    });
  }, [initialMcp, open, form]);

  const onSubmit = async (data: FormValues) => {
    await onSave({
      type: "sse",
      disabled: initialMcp?.disabled ?? false,
      id: data.id.trim(),
      url: data.url.trim(),
      headers: parseStringMap(data.headersRaw),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialMcp?.id
              ? t("settings.mcp.editMcp", "Edit MCP Server")
              : t("settings.mcp.addSseMcp", "Add SSE MCP Server")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.mcp.sseDialogDesc",
              "Configure the MCP server ID, SSE endpoint URL and request headers.",
            )}
          </DialogDescription>
        </DialogHeader>

        <form id="form-mcp-sse" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="py-2">
            <Controller
              name="id"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="mcp-sse-id" className="text-[11px] text-muted-foreground">
                    {t("settings.mcp.mcpId", "MCP Server ID")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="mcp-sse-id"
                    placeholder={t("settings.mcp.mcpId", "MCP Server ID")}
                    aria-invalid={fieldState.invalid}
                    disabled={!!initialMcp?.id}
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
              name="url"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="mcp-sse-url" className="text-[11px] text-muted-foreground">
                    {t("settings.mcp.url", "URL")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="mcp-sse-url"
                    placeholder={t("settings.mcp.url", "URL")}
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
                  <FieldLabel
                    htmlFor="mcp-sse-headers"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("settings.mcp.headers", "Headers (JSON)")}
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="mcp-sse-headers"
                    placeholder='{ "name": "value" }'
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
            {t("settings.mcp.cancel", "Cancel")}
          </Button>
          <Button type="submit" form="form-mcp-sse" size="sm" className="h-7 text-xs">
            {t("settings.mcp.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
