import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SpeechProviderInfo } from "../../../../shared/schema";
import { effectiveAsrModel, effectiveTtsVoice } from "../../../../shared/speech";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Plus, Pencil, Trash2, BookOpen } from "lucide-react";
import { extractErrorMessage, generateUUID } from "@/lib/utils";
import { openGuide } from "@/lib/open-guide";
import { useMessage } from "../../providers/message";
import type { SpeechProviderDraft, SpeechProviderId } from "./speech-form";
import { SpeechDashscopeForm } from "./speech-dashscope-form";
import { SpeechVolcengineForm } from "./speech-volcengine-form";
import { SpeechOpenaiForm } from "./speech-openai-form";
import { SpeechIflytekForm } from "./speech-iflytek-form";

/** 两个方向的开关字段名；用于列表卡片与 Dialog 的互斥切换。 */
type DirectionField = "asrEnabled" | "ttsEnabled";

interface SettingsSpeechDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProvider: SpeechProviderInfo | null;
  /** 当前渲染哪个 Provider 的表单（状态由父组件持有：打开弹窗 / 改选服务商时更新）。 */
  provider: SpeechProviderId;
  /**
   * 名称初值。只在打开弹窗 / 切换服务商时给出 —— 名称是表单自己的字段，
   * 若跟着每次输入回传，会让表单反复 reset、清掉其它未保存的输入。
   */
  seededName: string;
  /** 服务商被改选（带上此刻的名称）：父组件据此换表单并保留名称。 */
  onProviderChange: (provider: SpeechProviderId, name: string) => void;
  onSave: (provider: SpeechProviderInfo) => Promise<void> | void;
}

function SettingsSpeechDialog({
  open,
  onOpenChange,
  initialProvider,
  provider,
  seededName,
  onProviderChange,
  onSave,
}: SettingsSpeechDialogProps) {
  const { t } = useTranslation();

  const saveDraft = async (draft: SpeechProviderDraft) => {
    await onSave({
      id: initialProvider?.id ?? generateUUID().replace(/-/g, "").slice(0, 12),
      ...draft,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      {/* 左右结构：左列（名称/服务商 + 共享凭据）/ 右列（识别 / 合成），与 API Agent 弹窗同一套版式 */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {initialProvider
              ? t("settings.speech.editProvider", "Edit Provider")
              : t("settings.speech.addProvider", "Add Provider")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.speech.dialogDesc",
              "Configure one provider for speech recognition and/or speech synthesis.",
            )}
          </DialogDescription>
        </DialogHeader>

        {provider === "dashscope" && (
          <SpeechDashscopeForm
            open={open}
            initial={initialProvider}
            seededName={seededName}
            onSave={saveDraft}
            onProviderChange={onProviderChange}
          />
        )}
        {provider === "volcengine" && (
          <SpeechVolcengineForm
            open={open}
            initial={initialProvider}
            seededName={seededName}
            onSave={saveDraft}
            onProviderChange={onProviderChange}
          />
        )}
        {provider === "openai" && (
          <SpeechOpenaiForm
            open={open}
            initial={initialProvider}
            seededName={seededName}
            onSave={saveDraft}
            onProviderChange={onProviderChange}
          />
        )}
        {provider === "iflytek" && (
          <SpeechIflytekForm
            open={open}
            initial={initialProvider}
            seededName={seededName}
            onSave={saveDraft}
            onProviderChange={onProviderChange}
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
            {t("settings.speech.cancel", "Cancel")}
          </Button>
          <Button type="submit" form="form-speech" size="sm" className="h-7 text-xs">
            {t("settings.speech.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 语音设置页：一份 Provider 列表同时承载识别（ASR）与合成（TTS）。
 *
 * 每个 Provider 一条记录、两个方向开关；每方向全局至多启用一个
 * （打开某个方向时会自动关闭其他 Provider 上同方向的开关）。
 */
export function SettingsSpeech() {
  const { t, i18n } = useTranslation();
  const { speechProviders, setSpeechProviders } = useAppStore();
  const { toast, confirm } = useMessage();
  const [providers, setProviders] = useState<SpeechProviderInfo[]>([]);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogItem, setDialogItem] = useState<SpeechProviderInfo | null>(null);
  // 弹窗内的「正在编辑哪个 Provider / 名称草稿」由这里持有：
  // 打开弹窗与改选服务商都发生在这层（事件驱动），弹窗本身保持无状态
  const [dialogProvider, setDialogProvider] = useState<SpeechProviderId>("dashscope");
  const [dialogName, setDialogName] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setProviders(speechProviders);
  }, [speechProviders]);

  const handleSave = async (updated: SpeechProviderInfo[]) => {
    try {
      await request.updateSettings({ speechProviders: updated });
      setSpeechProviders(updated);
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.speech.updateFailed", "Failed to update configuration."),
      );
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setDialogItem(null);
  };

  const openAddDialog = () => {
    setDialogItem(null);
    setDialogProvider("dashscope");
    setDialogName("");
    setDialogOpen(true);
  };

  const openEditDialog = (provider: SpeechProviderInfo) => {
    setDialogItem(provider);
    setDialogProvider(provider.provider);
    setDialogName(provider.name);
    setDialogOpen(true);
  };

  const upsertProvider = async (next: SpeechProviderInfo) => {
    const isNew = dialogItem === null;
    // 首次添加且两个方向都没开时，默认作为识别 Provider 启用，省去一次手动开关
    const saved =
      isNew && !next.asrEnabled && !next.ttsEnabled && !providers.some((p) => p.asrEnabled)
        ? { ...next, asrEnabled: true }
        : next;
    const base = isNew
      ? [...providers, saved]
      : providers.map((provider) => (provider.id === dialogItem.id ? saved : provider));
    // 每方向全局至多一个启用
    const updated = base.map((provider) =>
      provider.id === saved.id
        ? provider
        : {
            ...provider,
            asrEnabled: saved.asrEnabled ? false : provider.asrEnabled,
            ttsEnabled: saved.ttsEnabled ? false : provider.ttsEnabled,
          },
    );
    setProviders(updated);
    closeDialog();
    await handleSave(updated);
  };

  const handleDelete = async (id: string) => {
    const result = await confirm({
      title: t("settings.speech.confirmDeleteTitle", "Delete Provider"),
      content: t(
        "settings.speech.confirmDeleteDesc",
        "Are you sure you want to delete this speech provider?",
      ),
      buttons: [
        { text: t("message.cancel", "Cancel"), value: null, variant: "outline" },
        {
          text: t("settings.speech.delete", "Delete"),
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

  /** 打开某方向的开关时，自动关闭其他 Provider 上同方向的开关。 */
  const handleToggleDirection = async (id: string, field: DirectionField, enabled: boolean) => {
    const updated = providers.map((provider) => {
      if (provider.id === id) {
        return field === "asrEnabled"
          ? { ...provider, asrEnabled: enabled }
          : { ...provider, ttsEnabled: enabled };
      }
      if (!enabled) return provider;
      return field === "asrEnabled"
        ? { ...provider, asrEnabled: false }
        : { ...provider, ttsEnabled: false };
    });
    setProviders(updated);
    await handleSave(updated);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-4xl px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">{t("settings.speech.title", "Speech")}</h3>
          <button
            type="button"
            onClick={() => openGuide(i18n.language, "speech-to-text.md")}
            className="inline-flex cursor-default items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookOpen className="size-3.5" />
            {t("settings.speech.guide", "User Guide")}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(
            "settings.speech.desc",
            "Configure voice input (speech-to-text) and voice output (speech synthesis).",
          )}
        </p>
      </div>

      <div className="mx-auto w-full max-w-4xl space-y-2 px-4">
        <div className="flex items-center justify-between p-1">
          <h3 className="text-xs text-foreground/50">
            {t("settings.speech.providers", "Providers")}
          </h3>
          <Button
            variant="outline"
            size="xs"
            onClick={openAddDialog}
            className="h-7 text-xs text-foreground/70"
          >
            <Plus className="mr-1 size-3" />
            {t("settings.speech.add", "Add Provider")}
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
                      className={`ml-1 max-w-32 shrink-0 truncate text-xs font-bold ${!provider.asrEnabled && !provider.ttsEnabled ? "text-muted-foreground/50" : ""}`}
                    >
                      {provider.name}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-medium uppercase text-muted-foreground/70">
                      {provider.provider}
                    </span>
                    <span className="w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                      {/* 与开关无关：展示识别 / 合成各配了什么，是否生效由右侧开关体现。
                          方向字段未配置时按生效值兜底（默认模型 / 默认音色见 shared/speech.ts） */}
                      {[
                        effectiveAsrModel(provider) || provider.asrResourceId,
                        [provider.ttsModel, effectiveTtsVoice(provider)]
                          .filter(Boolean)
                          .join("/"),
                      ]
                        .filter(Boolean)
                        .join(" · ") || provider.baseUrl}
                    </span>
                    <div className="ml-1 flex shrink-0 items-center gap-3">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">
                          {t("settings.speech.shortRecognition", "ASR")}
                        </span>
                        <Switch
                          size="sm"
                          checked={provider.asrEnabled}
                          onCheckedChange={(enabled) =>
                            handleToggleDirection(provider.id, "asrEnabled", enabled)
                          }
                          aria-label={t("settings.speech.form.recognition", "Recognition")}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">
                          {t("settings.speech.shortSynthesis", "TTS")}
                        </span>
                        <Switch
                          size="sm"
                          checked={provider.ttsEnabled}
                          onCheckedChange={(enabled) =>
                            handleToggleDirection(provider.id, "ttsEnabled", enabled)
                          }
                          aria-label={t("settings.speech.form.synthesis", "Synthesis")}
                        />
                      </div>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-32">
                  <ContextMenuItem onClick={() => openEditDialog(provider)}>
                    <Pencil className="size-3" />
                    {t("settings.speech.edit", "Edit")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => handleDelete(provider.id)}>
                    <Trash2 className="size-3" />
                    {t("settings.speech.delete", "Delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
            {providers.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("settings.speech.empty", "No speech providers configured")}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <SettingsSpeechDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
          else setDialogOpen(true);
        }}
        initialProvider={dialogItem}
        provider={dialogProvider}
        seededName={dialogName}
        onProviderChange={(nextProvider, name) => {
          setDialogName(name);
          setDialogProvider(nextProvider);
        }}
        onSave={upsertProvider}
      />
    </div>
  );
}
