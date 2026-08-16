import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { z } from "zod";
import type { StdioAgentInfo } from "../../../../shared/schema";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Ellipsis } from "lucide-react";

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

// ── Quick presets ────────────────────────────────────────────────────

interface AcpPreset {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** 内置快速预设（与 guides/zh-CN/agents-*.md 中的推荐配置一致） */
const BUILT_IN_PRESETS: AcpPreset[] = [
  { id: "kiro", command: "kiro-cli", args: ["acp"], env: {} },
  { id: "kimi", command: "kimi-cli", args: ["acp"], env: {} },
  { id: "codebuddy", command: "codebuddy", args: ["--acp"], env: {} },
];

const schema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "settings.agents.validation.enterId")
    .regex(/^[a-zA-Z0-9_-]+$/, "settings.agents.validation.idFormat"),
  command: z.string().trim().min(1, "settings.agents.validation.enterCommand"),
  argsRaw: z.string(),
  envRaw: z.string().refine(isValidStringMap, "settings.agents.validation.jsonObject"),
});

type FormValues = z.input<typeof schema>;

interface SettingsAgentStdioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAgent: StdioAgentInfo | null;
  onSave: (agent: StdioAgentInfo) => Promise<void> | void;
}

export function SettingsAgentStdioDialog({
  open,
  onOpenChange,
  initialAgent,
  onSave,
}: SettingsAgentStdioDialogProps) {
  const { t } = useTranslation();

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(schema),
    mode: "all",
    defaultValues: { id: "", command: "", argsRaw: "", envRaw: "" },
  });

  const applyPreset = (preset: AcpPreset) => {
    form.setValue("command", preset.command);
    form.setValue("argsRaw", preset.args.join(" "));
    if (Object.keys(preset.env).length > 0) {
      form.setValue("envRaw", JSON.stringify(preset.env, null, "  "));
    }
    if (!initialAgent?.id) {
      form.setValue("id", preset.id);
    }
    form.trigger();
  };

  useEffect(() => {
    if (!open) return;
    form.reset({
      id: initialAgent?.id ?? "",
      command: initialAgent?.command ?? "",
      argsRaw: initialAgent?.args?.join(" ") ?? "",
      envRaw:
        initialAgent && Object.keys(initialAgent.env || {}).length > 0
          ? JSON.stringify(initialAgent.env, null, "  ")
          : "",
    });
  }, [initialAgent, open, form]);

  const onSubmit = async (data: FormValues) => {
    await onSave({
      type: "stdio",
      disabled: initialAgent?.disabled ?? false,
      id: data.id.trim(),
      command: data.command.trim(),
      args: data.argsRaw.split(/\s+/).filter(Boolean),
      env: parseStringMap(data.envRaw),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialAgent?.id
              ? t("settings.agents.editStdioAgent", "Edit ACP Agent")
              : t("settings.agents.addStdioAgent", "Add via ACP Agent")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.agents.dialogDesc",
              "Configure the agent ID, command, arguments and environment variables.",
            )}
          </DialogDescription>
        </DialogHeader>

        <form id="form-stdio-agent" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="py-2">
            <Controller
              name="id"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="stdio-id" className="text-[11px] text-muted-foreground">
                    {t("settings.agents.agentId")}
                  </FieldLabel>
                  <div className="flex items-center gap-1">
                    <Input
                      {...field}
                      id="stdio-id"
                      placeholder={t("settings.agents.agentId")}
                      aria-invalid={fieldState.invalid}
                      disabled={!!initialAgent?.id}
                      className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-8 shrink-0"
                            title={t("settings.agents.quickPreset", "Quick preset")}
                          />
                        }
                      >
                        <Ellipsis className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-full">
                        {BUILT_IN_PRESETS.map((preset) => (
                          <DropdownMenuItem key={preset.id} onClick={() => applyPreset(preset)}>
                            <span className="truncate text-[10px] mr-auto text-muted-foreground/60">
                              {preset.id}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono pl-3">
                              {[preset.command, ...preset.args].join(" ")}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
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

            <Controller
              name="command"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="stdio-command" className="text-[11px] text-muted-foreground">
                    {t("settings.agents.command")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="stdio-command"
                    placeholder={t("settings.agents.command")}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
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
              name="argsRaw"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="stdio-args" className="text-[11px] text-muted-foreground">
                    {t("settings.agents.args")}
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="stdio-args"
                    placeholder={t("settings.agents.args")}
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
                  <FieldLabel htmlFor="stdio-env" className="text-[11px] text-muted-foreground">
                    {t("settings.agents.envVars", "Env vars")}
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="stdio-env"
                    placeholder={t("settings.agents.envJson")}
                    aria-invalid={fieldState.invalid}
                    className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5 min-h-15 break-all max-w-full"
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
            {t("settings.agents.cancel")}
          </Button>
          <Button type="submit" form="form-stdio-agent" size="sm" className="h-7 text-xs">
            {t("settings.agents.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
