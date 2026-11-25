import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { z } from "zod";
import type { StdioAgentInfo } from "../../../../shared/schema";
import { useAppStore } from "../../../store";
import { AutocompleteInput, type AutocompleteOption } from "../../common/autocomplete-input";
import { Button } from "@/components/ui/button";
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
  {
    id: "kiro_v3",
    command: "kiro-cli",
    args: ["acp", "--agent-engine=v3", "--auth-method=cli"],
    env: {},
  },
  { id: "kimi", command: "kimi-cli", args: ["acp"], env: {} },
  { id: "codebuddy", command: "codebuddy", args: ["--acp"], env: {} },
];

/**
 * Agent ID 候选：只给内置预设。
 * ID 必须全局唯一，所以不混入已配置的 Agent（选到已占用的 ID 只会触发重复校验）。
 */
const ID_OPTIONS: AutocompleteOption[] = BUILT_IN_PRESETS.map((preset) => ({
  value: preset.id,
  detail: [preset.command, ...preset.args].join(" "),
}));

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
  const configuredAgents = useAppStore((state) => state.configuredAgents);

  /** Command 候选：内置预设使用的命令 + 已配置 stdio Agent 的命令。 */
  const commandOptions = useMemo<AutocompleteOption[]>(() => {
    const seen = new Set<string>();
    const options: AutocompleteOption[] = [];
    for (const preset of BUILT_IN_PRESETS) {
      if (seen.has(preset.command)) continue;
      seen.add(preset.command);
      options.push({ value: preset.command, detail: preset.id });
    }
    for (const agent of configuredAgents) {
      if (agent.type !== "stdio") continue;
      const command = agent.command.trim();
      if (!command || seen.has(command)) continue;
      seen.add(command);
      options.push({ value: command, detail: agent.id });
    }
    return options;
  }, [configuredAgents]);

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
                  <AutocompleteInput
                    ref={field.ref}
                    name={field.name}
                    onBlur={field.onBlur}
                    id="stdio-id"
                    value={field.value}
                    onChange={field.onChange}
                    options={ID_OPTIONS}
                    // 选中内置预设时，顺带填好命令 / 参数 / 环境变量。
                    onPick={(option) => {
                      const preset = BUILT_IN_PRESETS.find(
                        (candidate) => candidate.id === option.value,
                      );
                      if (preset) applyPreset(preset);
                    }}
                    placeholder={t("settings.agents.agentId")}
                    emptyHint={t(
                      "settings.agents.suggestionEmpty",
                      "No suggestions — type a value.",
                    )}
                    noMatchHint={t("settings.agents.suggestionNoMatch", "No match — type a value.")}
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
              name="command"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="stdio-command" className="text-[11px] text-muted-foreground">
                    {t("settings.agents.command")}
                  </FieldLabel>
                  <AutocompleteInput
                    ref={field.ref}
                    name={field.name}
                    onBlur={field.onBlur}
                    id="stdio-command"
                    value={field.value}
                    onChange={field.onChange}
                    options={commandOptions}
                    placeholder={t("settings.agents.command")}
                    emptyHint={t(
                      "settings.agents.suggestionEmpty",
                      "No suggestions — type a value.",
                    )}
                    noMatchHint={t("settings.agents.suggestionNoMatch", "No match — type a value.")}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    aria-invalid={fieldState.invalid}
                    className="h-8 text-[11px]! text-foreground/70 focus-visible:ring-0.5"
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
