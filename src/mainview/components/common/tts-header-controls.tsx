import { useTranslation } from "react-i18next";
import { AudioLines, Square, Volume2, VolumeX } from "lucide-react";
import { useTtsPrefsStore } from "../../lib/tts/tts-prefs";
import { useTtsPlaybackStore } from "../../lib/tts/tts-player";
import { stopActiveTts } from "../../lib/tts/tts-reader";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

/**
 * 「正在朗读」指示 + 停止（仅在有会话出声时出现）。
 *
 * 整颗药丸就是一个按钮：点击区域 = 整个可见区域（`h-6` + `px-2`），不存在
 * 「只有尾巴上的方块能点」这种歧义；点到文字/图标同样生效。
 */
export function TtsReadoutButton() {
  const { t } = useTranslation();
  const activeSessionId = useTtsPlaybackStore((state) => state.activeSessionId);
  if (!activeSessionId) return null;

  return (
    <button
      type="button"
      onClick={stopActiveTts}
      title={t("chatHeader.stopReading", "Stop reading")}
      aria-label={t("chatHeader.stopReading", "Stop reading")}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-[11px] text-muted-foreground select-none outline-none transition-colors hover:border-primary/40 hover:text-foreground"
    >
      <AudioLines className="size-3 shrink-0 animate-pulse text-primary" />
      <span className="truncate">{t("chatHeader.reading", "Reading…")}</span>
      <Square className="size-2.5 shrink-0 fill-current opacity-70" />
    </button>
  );
}

/**
 * 朗读菜单（流式自动朗读开关 + 音量）。
 *
 * 两个偏好都存在 localStorage（`fello.tts.prefs`），改完立即生效：开关走 `Chat` 里的
 * 朗读订阅，音量直接作用于播放器的 master GainNode。
 *
 * 放在会话头部而不是设置页：自动朗读只作用于**当前显示的会话**（朗读生命周期由 `Chat`
 * 持有，切走即结束），就地可切更顺手。
 */
export function TtsMenuButton() {
  const { t } = useTranslation();
  const autoRead = useTtsPrefsStore((state) => state.autoRead);
  const setAutoRead = useTtsPrefsStore((state) => state.setAutoRead);
  const volume = useTtsPrefsStore((state) => state.volume);
  const setVolume = useTtsPrefsStore((state) => state.setVolume);

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        title={t("chatHeader.autoRead", "Auto-read replies")}
        className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 outline-none transition-colors hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 data-pressed:bg-sidebar-accent/40"
      >
        {autoRead ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side="bottom" align="end" sideOffset={4}>
          <PopoverPrimitive.Popup className="z-10 w-60 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none p-1.5 origin-(--transform-origin) data-ending-style:scale-90 data-starting-style:scale-90 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-[transform,opacity] duration-100">
            <div
              className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors cursor-default"
              onClick={() => setAutoRead(!autoRead)}
            >
              <span className="mr-2 truncate">{t("chatHeader.autoRead", "Auto-read replies")}</span>
              <div onClick={(event) => event.stopPropagation()}>
                <Switch size="sm" checked={autoRead} onCheckedChange={setAutoRead} />
              </div>
            </div>

            <div className="px-2 py-1.5">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("chatHeader.volume", "Volume")}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
                  {volume}
                </span>
              </div>
              <div className="pb-1">
                <Slider
                  value={[volume]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) => setVolume(Array.isArray(value) ? value[0] : value)}
                />
              </div>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
