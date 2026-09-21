import { useEffect, useMemo } from "react";
import { isWebUI, subscribe } from "../../backend";
import { useAppStore } from "../../store";
import {
  BUILTIN_PERIPHERALS,
  isPeripheralRuntimeAvailable,
  isPeripheralSupportedOnPlatform,
} from "../../../shared/peripherals";
import { RENDERER_PLATFORM } from "./platform";
import { useVoicePanelController } from "./voice-panel-provider";

/**
 * 外设运行时（渲染层）。
 *
 * 这里只做两件事，而且**只有在对应外设「生效」时才装载**：
 * 1. 把描述符里声明的键盘按键（如遥控器语音键 F5）绑到面板的启动/停止；
 *    「按住」语义需要 keydown + keyup 配对，因此不走 `useKeyboardShortcuts`
 *    （它只监听 keydown 且主动跳过 `event.repeat`），也不进 command catalog。
 * 2. 把主进程 HID 通道送上来的按键事件注入成系统按键（如「返回」→ Escape），
 *    让各组件现有的 Escape 行为直接生效。
 *
 * 门禁：WebUI 不装载（没有 node 能力，也没有外设通道）。
 */

export function PeripheralRuntime() {
  const peripherals = useAppStore((state) => state.peripherals);
  // 只取稳定的两个函数：面板在录音期间会因转写 / 电平持续重渲染，
  // 依赖整个 controller 对象会让按键监听在每次转写时都被重建一遍。
  const { start: startVoicePanel, stop: stopVoicePanel } = useVoicePanelController();
  const platform = RENDERER_PLATFORM;
  const available = isPeripheralRuntimeAvailable({ isWebUI, platform });

  const enabledIds = useMemo(
    () => new Set(peripherals.filter((entry) => entry.enabled).map((entry) => entry.id)),
    [peripherals],
  );

  /** 生效外设的「按住」型键盘按键 → 外设 id。 */
  const holdKeyOwners = useMemo(() => {
    const owners = new Map<string, string>();
    if (!available) return owners;
    for (const peripheral of BUILTIN_PERIPHERALS) {
      if (!enabledIds.has(peripheral.id)) continue;
      if (!isPeripheralSupportedOnPlatform(peripheral, platform)) continue;
      for (const key of peripheral.keys) {
        if (key.transport !== "keyboard" || key.kind !== "hold" || !key.code) continue;
        owners.set(key.code, peripheral.id);
      }
    }
    return owners;
  }, [available, enabledIds, platform]);

  // 1) 按住型按键：keydown 启动面板，keyup 收尾。
  useEffect(() => {
    if (holdKeyOwners.size === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      const peripheralId = holdKeyOwners.get(event.code);
      if (!peripheralId) return;
      // F5 在部分平台/浏览器里是刷新，统一拦掉，避免误触。
      event.preventDefault();
      event.stopPropagation();
      startVoicePanel(peripheralId);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!holdKeyOwners.has(event.code)) return;
      event.preventDefault();
      stopVoicePanel();
    };
    // 窗口失焦（切到别的应用、遥控器切走）时 keyup 会丢失，面板会一直停在录音态 ——
    // 这里兜底收尾，不用等到 5 分钟上限。
    const handleBlur = () => stopVoicePanel();
    // 面板本身在 window 上监听 Escape，这里用捕获阶段保证先于输入框拿到按键。
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [holdKeyOwners, startVoicePanel, stopVoicePanel]);

  // 2) HID 通道的按键 → 注入系统按键（仅前台窗口响应）。
  useEffect(() => {
    if (!available) return;
    const handlePeripheralKey = (event: {
      peripheralId: string;
      keyId: string;
      action: "down" | "up";
      systemKey?: string;
    }) => {
      if (!enabledIds.has(event.peripheralId)) return;
      if (!event.systemKey) return;
      // HID 是进程级监听，后台也会收到报文：只在窗口聚焦时注入。
      if (!document.hasFocus()) return;
      const target = document.activeElement ?? document.body;
      // 注意：这里把 `systemKey` 同时当作 `key` 与 `code`，所以描述符里的 `systemKey`
      // **必须与 `KeyboardEvent.code` 同名**（当前只有 `Escape`，两者恰好同名）。
      // 若以后要映射到 `Enter` / `Backspace` 这类 key 与 code 不同名的键，
      // 必须先在这里引入 { key, code } 映射，否则会注入一个 code 错误的按键事件。
      target.dispatchEvent(
        new KeyboardEvent(event.action === "down" ? "keydown" : "keyup", {
          key: event.systemKey,
          code: event.systemKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    subscribe.on("peripheral-key", handlePeripheralKey);
    return () => subscribe.off("peripheral-key", handlePeripheralKey);
  }, [available, enabledIds]);

  return null;
}
