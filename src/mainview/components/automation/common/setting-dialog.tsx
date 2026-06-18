import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import type { Schedule, Feature } from "../../../../shared/schema";
import { ALL_FEATURES, FEATURE_I18N_KEYS } from "../../../../shared/constants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { LoaderCircle } from "lucide-react";
import { useMessage } from "../../providers/message";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { CronEditor } from "./cron-editor";

const DISABLED_FEATURES: Feature[] = ["ask_user", "share_to_user"];

interface Props {
  schedule?: Schedule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function SettingDialog({ schedule, open, onOpenChange, onSuccess }: Props) {
  const isEdit = !!schedule;
  const { t } = useTranslation();
  const { toast } = useMessage();
  const configuredAgents = useAppStore((s) => s.configuredAgents);
  const configuredMcpServers = useAppStore((s) => s.configuredMcpServers);
  const enabledAgents = useMemo(
    () => configuredAgents.filter((a) => !a.disabled),
    [configuredAgents],
  );
  const enabledMcpServers = useMemo(
    () => configuredMcpServers.filter((s) => !s.disabled),
    [configuredMcpServers],
  );

  const [timezone, setTimezone] = useState<string>("");
  useEffect(() => {
    request
      .getServerTimezone()
      .then(setTimezone)
      .catch(() => {});
  }, []);

  const [name, setName] = useState(isEdit ? schedule!.name : "");
  const [agentId, setAgentId] = useState(isEdit ? schedule!.agentId : (enabledAgents[0]?.id ?? ""));
  const [prompt, setPrompt] = useState(isEdit ? schedule!.prompt : "");
  const [cronType, setCronType] = useState<"cron" | "manual">(
    isEdit ? schedule!.cron.type : "cron",
  );
  const [cronExpr, setCronExpr] = useState(
    isEdit ? (schedule!.cron.expr ?? "0 9 * * 1-5") : "0 9 * * 1-5",
  );
  const [features, setFeatures] = useState<Feature[]>(
    isEdit ? (schedule!.features ?? ["skills"]) : ["skills"],
  );
  const [mcpServerIds, setMcpServerIds] = useState<string[]>(
    isEdit ? (schedule!.mcpServers ?? []) : enabledMcpServers.map((s) => s.id),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setName(schedule.name);
      setAgentId(schedule.agentId);
      setPrompt(schedule.prompt);
      setCronType(schedule.cron.type);
      setCronExpr(schedule.cron.expr ?? "0 9 * * 1-5");
      setFeatures(schedule.features ?? ["skills"]);
      setMcpServerIds(schedule.mcpServers ?? []);
    } else {
      setName("");
      setAgentId(enabledAgents[0]?.id ?? "");
      setPrompt("");
      setCronType("cron");
      setCronExpr("0 9 * * 1-5");
      setFeatures(["skills"]);
      setMcpServerIds(enabledMcpServers.map((s) => s.id));
    }
  }, [schedule, open]);

  const handleSave = async () => {
    if (!name.trim())
      return void toast.error(t("automation.validation.nameRequired", "Name is required"));
    if (!agentId)
      return void toast.error(t("automation.validation.agentRequired", "Agent is required"));
    if (!prompt.trim())
      return void toast.error(t("automation.validation.promptRequired", "Prompt is required"));

    setSaving(true);
    try {
      if (isEdit) {
        await request.updateSchedule({
          scheduleId: schedule!.id,
          updates: {
            name: name.trim(),
            agentId,
            prompt: prompt.trim(),
            cron: { type: cronType, expr: cronType === "cron" ? cronExpr.trim() : undefined },
            features,
            mcpServers: mcpServerIds,
          } as any,
        });
      } else {
        await request.createSchedule({
          name: name.trim(),
          agentId,
          prompt: prompt.trim(),
          cron: { type: cronType, expr: cronType === "cron" ? cronExpr.trim() : undefined },
          features,
          mcpServers: mcpServerIds,
        });
      }
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open, eventDetails) => {
        if (
          !open &&
          (eventDetails?.reason === "escape-key" || eventDetails?.reason === "outside-press")
        )
          return;
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("automation.editSchedule", "Edit Schedule")
              : t("automation.newSchedule", "New Schedule")}
          </DialogTitle>
          <DialogDescription>
            {t("automation.dialogDesc", "Configure the automated task schedule and prompt.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-5">
          {/* Left: Name, Agent, Prompt */}
          <FieldGroup>
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <Field>
                <FieldLabel htmlFor="auto-name" className="text-xs text-muted-foreground">
                  {t("automation.scheduleName", "Schedule Name")}
                </FieldLabel>
                <Input
                  id="auto-name"
                  placeholder={t(
                    "automation.scheduleNamePlaceholder",
                    "e.g. Morning Standup Summary",
                  )}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="auto-agent" className="text-xs text-muted-foreground">
                  {t("automation.agent", "Agent")}
                </FieldLabel>
                <Select
                  value={agentId}
                  onValueChange={(v) => {
                    if (v) setAgentId(v);
                  }}
                >
                  <SelectTrigger id="auto-agent" className="w-full text-xs! text-muted-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledAgents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="auto-prompt" className="text-xs text-muted-foreground">
                {t("automation.prompt", "Prompt")}
              </FieldLabel>
              <Textarea
                id="auto-prompt"
                placeholder={t("automation.promptPlaceholder", "What should the agent do?")}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="text-xs! min-h-46 flex-1 text-foreground/70 focus-visible:ring-0.5"
              />
            </Field>
          </FieldGroup>

          {/* Right: Features, MCP, Schedule */}
          <FieldGroup>
            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted-foreground">
                {t("automation.features", "Features")}
              </div>
              <div
                className={
                  ALL_FEATURES.length >= 2 ? "grid grid-cols-2 gap-1" : "flex flex-col gap-1"
                }
              >
                {ALL_FEATURES.map((feature) => {
                  const isDisabled = DISABLED_FEATURES.includes(feature);
                  return (
                    <div
                      key={feature}
                      className={`flex items-center justify-between rounded border bg-secondary/50 px-2 h-7 ${!isDisabled ? "cursor-default" : ""} hover:bg-accent transition-colors`}
                      onClick={
                        !isDisabled
                          ? () =>
                              setFeatures((prev) =>
                                prev.includes(feature)
                                  ? prev.filter((f) => f !== feature)
                                  : [...prev, feature],
                              )
                          : undefined
                      }
                    >
                      <div
                        className={`text-xs truncate ${
                          !isDisabled
                            ? features.includes(feature)
                              ? "text-muted-foreground"
                              : "text-muted-foreground/50"
                            : "text-muted-foreground/50"
                        }`}
                      >
                        {t(FEATURE_I18N_KEYS[feature], feature)}
                        {isDisabled && (
                          <span className="text-[10px] ml-1">
                            ({t("automation.alwaysDisabled", "always disabled")})
                          </span>
                        )}
                      </div>
                      <div onClick={!isDisabled ? (e) => e.stopPropagation() : undefined}>
                        <Switch
                          size="sm"
                          checked={!isDisabled ? features.includes(feature) : false}
                          disabled={isDisabled}
                          onCheckedChange={
                            !isDisabled
                              ? (c) =>
                                  setFeatures((prev) =>
                                    c ? [...prev, feature] : prev.filter((f) => f !== feature),
                                  )
                              : undefined
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {configuredMcpServers.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  {t("automation.mcpServers", "MCP Servers")}
                </div>
                <div
                  className={
                    configuredMcpServers.length >= 2
                      ? "grid grid-cols-2 gap-1"
                      : "flex flex-col gap-1"
                  }
                >
                  {configuredMcpServers.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded border bg-secondary/50 px-2 h-7 cursor-default hover:bg-accent transition-colors"
                      onClick={() =>
                        setMcpServerIds((prev) =>
                          prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                        )
                      }
                    >
                      <div
                        className={`text-xs truncate ${mcpServerIds.includes(s.id) ? "text-muted-foreground" : "text-muted-foreground/50"}`}
                        title={s.id}
                      >
                        {s.id}
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch
                          size="sm"
                          checked={mcpServerIds.includes(s.id)}
                          onCheckedChange={(c) => {
                            setMcpServerIds((prev) =>
                              c ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                            );
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Field>
              <FieldLabel className="text-xs text-muted-foreground">
                {t("automation.schedule", "Schedule")}
              </FieldLabel>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-foreground/70">
                  <Switch
                    checked={cronType === "cron"}
                    onCheckedChange={(c) => setCronType(c ? "cron" : "manual")}
                  />
                  {t("automation.timedExecution", "Timed (cron)")}
                </div>
                {cronType === "cron" ? (
                  <CronEditor value={cronExpr} onChange={setCronExpr} timezone={timezone} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("automation.manualDesc", "Manual trigger only. No automatic scheduling.")}
                  </p>
                )}
              </div>
            </Field>
          </FieldGroup>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {t("automation.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={handleSave}
            className="h-7 text-xs"
          >
            {saving && <LoaderCircle className="size-3 animate-spin mr-1" />}
            {isEdit ? t("automation.save", "Save") : t("automation.create", "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
