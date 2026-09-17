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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoaderCircle } from "lucide-react";
import { useMessage } from "../../providers/message";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { CronEditor } from "./cron-editor";

const DISABLED_FEATURES: Feature[] = ["ask_user", "share_to_user", "memory"];

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
  const [modelId, setModelId] = useState(isEdit ? (schedule!.modelId ?? "") : "");
  const [remainingRuns, setRemainingRuns] = useState(
    isEdit && schedule!.remainingRuns !== null ? String(schedule!.remainingRuns) : "",
  );
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
      // eslint-disable-next-line react/set-state-in-effect
      setName(schedule.name);
      setAgentId(schedule.agentId);
      setModelId(schedule.modelId ?? "");
      setRemainingRuns(schedule.remainingRuns !== null ? String(schedule.remainingRuns) : "");
      setPrompt(schedule.prompt);
      setCronType(schedule.cron.type);
      setCronExpr(schedule.cron.expr ?? "0 9 * * 1-5");
      setFeatures(schedule.features ?? ["skills"]);
      setMcpServerIds(schedule.mcpServers ?? []);
    } else {
      setName("");
      setAgentId(enabledAgents[0]?.id ?? "");
      setModelId("");
      setRemainingRuns("");
      setPrompt("");
      setCronType("cron");
      setCronExpr("0 9 * * 1-5");
      setFeatures(["skills"]);
      setMcpServerIds(enabledMcpServers.map((s) => s.id));
    }
  }, [schedule, open, enabledMcpServers, enabledAgents]);

  const handleSave = async () => {
    if (!name.trim())
      return void toast.error(t("automation.validation.nameRequired", "Name is required"));
    if (!agentId)
      return void toast.error(t("automation.validation.agentRequired", "Agent is required"));
    if (!prompt.trim())
      return void toast.error(t("automation.validation.promptRequired", "Prompt is required"));
    // 执行次数仅对定时（cron）计划有意义：手动计划不校验、不保存该配置
    let parsedRemainingRuns: number | null = null;
    if (cronType === "cron") {
      const runsText = remainingRuns.trim();
      if (runsText !== "" && !/^\d+$/.test(runsText))
        return void toast.error(
          t("automation.validation.runLimitInvalid", "Run limit must be a non-negative integer"),
        );
      // 留空表示不限次数
      parsedRemainingRuns = runsText === "" ? null : Number(runsText);
    }

    setSaving(true);
    try {
      if (isEdit) {
        await request.updateSchedule({
          scheduleId: schedule!.id,
          updates: {
            name: name.trim(),
            agentId,
            modelId: modelId.trim() || undefined,
            prompt: prompt.trim(),
            cron: { type: cronType, expr: cronType === "cron" ? cronExpr.trim() : undefined },
            remainingRuns: parsedRemainingRuns,
            features,
            mcpServers: mcpServerIds,
          },
        });
      } else {
        await request.createSchedule({
          name: name.trim(),
          agentId,
          modelId: modelId.trim() || undefined,
          prompt: prompt.trim(),
          cron: { type: cronType, expr: cronType === "cron" ? cronExpr.trim() : undefined },
          remainingRuns: parsedRemainingRuns,
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
          {/* Left: Name, Agent, Model, Prompt */}
          <FieldGroup>
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

            <div className="grid grid-cols-2 gap-3">
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

              <Field>
                <FieldLabel htmlFor="auto-model" className="text-xs text-muted-foreground">
                  {t("automation.model", "Model")}
                </FieldLabel>
                <Input
                  id="auto-model"
                  placeholder={t("automation.modelPlaceholder", "Default model")}
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
                />
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
                className="text-xs! min-h-64 flex-1 text-foreground/70 focus-visible:ring-0.5"
              />
            </Field>
          </FieldGroup>

          {/* Right: Features, MCP, Schedule (incl. run limit) */}
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
                      className={`flex items-center justify-between rounded border bg-secondary/50 px-2 h-7 ${!isDisabled ? "cursor-default" : "hidden"} hover:bg-accent transition-colors`}
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
              <div className="flex flex-col gap-2.5 rounded-lg border border-border/70 bg-secondary/30 p-2.5">
                <div className="flex items-center gap-2">
                  <Tabs
                    value={cronType}
                    onValueChange={(v) => setCronType(v as "cron" | "manual")}
                    className="gap-0"
                  >
                    <TabsList className="h-7! gap-0.5 rounded-md border border-border bg-secondary/60 p-0.5">
                      <TabsTrigger value="cron" className="h-full min-w-11 rounded-sm px-2 text-xs">
                        {t("automation.timed", "Timed")}
                      </TabsTrigger>
                      <TabsTrigger
                        value="manual"
                        className="h-full min-w-11 rounded-sm px-2 text-xs"
                      >
                        {t("automation.manual", "Manual")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {cronType === "cron" && (
                    <div className="ml-auto flex items-center gap-2">
                      <FieldLabel
                        htmlFor="auto-remaining-runs"
                        className="shrink-0 text-[11px] text-muted-foreground"
                      >
                        {t("automation.remainingRuns", "Run Limit")}
                      </FieldLabel>
                      <Input
                        id="auto-remaining-runs"
                        inputMode="numeric"
                        title={t("automation.remainingRunsDesc", "Empty = unlimited")}
                        placeholder={t("automation.remainingRunsPlaceholder", "∞")}
                        value={remainingRuns}
                        onChange={(e) => setRemainingRuns(e.target.value)}
                        className="h-6 w-12 shrink-0 px-1 text-center text-xs! text-foreground/70 focus-visible:ring-0.5"
                      />
                    </div>
                  )}
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
