import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { z } from "zod";
import type { StdioMcpServerInfo } from "../../../../shared/schema";
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
    .min(1, "Please enter a server ID")
    .regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, _ and - allowed"),
  command: z.string().trim().min(1, "Please enter a command"),
  argsRaw: z.string(),
  envRaw: z.string().refine(isValidStringMap, "Must be a valid JSON object with string values"),
});

type FormValues = z.input<typeof schema>;

interface SettingsMcpStdioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMcp: StdioMcpServerInfo | null;
  onSave: (mcp: StdioMcpServerInfo) => Promise<void> | void;
}

export function SettingsMcpStdioDialog({
  open,
  onOpenChange,
  initialMcp,
  onSave,
}: SettingsMcpStdioDialogProps) {
  const { t } = useTranslation();

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(schema),
    mode: "onTouched",
    defaultValues: { id: "", command: "", argsRaw: "", envRaw: "" },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      id: initialMcp?.id ?? "",
      command: initialMcp?.command ?? "",
      argsRaw: initialMcp?.args?.join(" ") ?? "",
      envRaw:
        initialMcp && Object.keys(initialMcp.env || {}).length > 0
          ? JSON.stringify(initialMcp.env, null, "  ")
          : "",
    });
  }, [initialMcp, open, form]);

  const onSubmit = async (data: FormValues) => {
    await onSave({
      type: "stdio",
      disabled: initialMcp?.disabled ?? false,
      id: data.id.trim(),
      command: data.command.trim(),
      args: data.argsRaw.split(/\s+/).filter(Boolean),
      env: parseStringMap(data.envRaw),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialMcp?.id
              ? t("settings.mcp.editMcp", "Edit MCP Server")
              : t("settings.mcp.addStdioMcp", "Add Stdio MCP Server")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.mcp.dialogDesc",
              "Configure the MCP server ID, command, arguments and environment variables.",
            )}
          </DialogDescription>
        </DialogHeader>

        <form id="form-mcp-stdio" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="py-2">
            <Controller
              name="id"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="mcp-stdio-id" className="text-[11px] text-muted-foreground">
                    {t("settings.mcp.mcpId", "MCP Server ID")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="mcp-stdio-id"
                    placeholder={t("settings.mcp.mcpId", "MCP Server ID")}
                    aria-invalid={fieldState.invalid}
                    disabled={!!initialMcp?.id}
                    className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="command"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel
                    htmlFor="mcp-stdio-command"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("settings.mcp.command", "Command")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="mcp-stdio-command"
                    placeholder={t("settings.mcp.command", "Command")}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    aria-invalid={fieldState.invalid}
                    className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="argsRaw"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel
                    htmlFor="mcp-stdio-args"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("settings.mcp.args", "Arguments")}
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="mcp-stdio-args"
                    placeholder={t("settings.mcp.args", "Arguments")}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5 min-h-15 break-all max-w-full"
                    rows={3}
                  />
                </Field>
              )}
            />

            <Controller
              name="envRaw"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel
                    htmlFor="mcp-stdio-env"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("settings.mcp.envVars", "Environment Variables (JSON)")}
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="mcp-stdio-env"
                    placeholder={t("settings.mcp.envJson", "Environment Variables (JSON)")}
                    aria-invalid={fieldState.invalid}
                    className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5 min-h-15 break-all max-w-full"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
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
          <Button type="submit" form="form-mcp-stdio" size="sm" className="h-7 text-xs">
            {t("settings.mcp.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
