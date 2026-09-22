/**
 * 通用 HID 通道：按外设描述符枚举 HID interface，并把报文映射成按键事件。
 *
 * 设计约定（需求：「HID 也属于外设框架的一部分，只做按键映射」）：
 * - 本文件**不含任何设备特判**；VID/PID 与报文→按键的映射全部来自描述符，
 *   不同设备可以完全不一样；
 * - 只做「报文 → 按键按下/松开」，键的语义（例如注入 Escape）由描述符的 `systemKey` 声明，
 *   由渲染层的运行时决定怎么用；
 * - 打开失败（含 macOS 未授予「输入监控」权限）**绝不能**阻塞宿主或影响 BLE 通道，
 *   只上报状态。
 *
 * 权限说明：macOS 10.15+ 打开键盘类 HID 需要「输入监控」权限。**这条链路不需要任何权限库**：
 * 系统会在我们调用 `IOHIDDeviceOpen`（即 node-hid 打开设备）时替本进程发起请求 —— 没有 TCC
 * 记录时弹出系统对话框，并把 Fello 登记进「输入监控」列表，用户之后可在设置里手动勾选
 * （Apple 头文件写明 `IOHIDManagerOpen` / `IOHIDDeviceOpen` 会代发该请求，macOS 27 实测也会
 * 弹窗）。用户拒绝过一次后系统**不再弹窗**，所以这里只上报状态、不主动拉起设置面板，
 * 跳转交给设置页的「输入监控设置」按钮由用户主动点。
 * 「枚举到设备」与「收到过报文」两个事实仍用来区分「没插/没连」与「没权限」，
 * 状态文案也按此措辞。
 */

import { createRequire } from "module";
import type { PeripheralHidDefinition } from "../../shared/peripherals";

const require = createRequire(import.meta.url);

export interface HidTransportStatus {
  state:
    | "enumerated"
    | "listening"
    | "unavailable"
    | "error"
    | "stopped"
    | "report-received"
    /** macOS 缺「输入监控」权限（`IOHIDDeviceOpen` 返回 kIOReturnNotPermitted）：须由用户去设置里授权后重启应用。 */
    | "permission-required";
  message: string;
  detail?: string;
}

export interface HidKeyEvent {
  keyId: string;
  action: "down" | "up";
}

export interface HidTransportOptions {
  hid: PeripheralHidDefinition;
  onStatus: (status: HidTransportStatus) => void;
  onKey: (event: HidKeyEvent) => void;
}

export interface HidTransport {
  start: () => Promise<{ listening: number }>;
  stop: () => Promise<void>;
}

// node-hid 未随包发布类型，这里只声明实际用到的部分。
/* eslint-disable @typescript-eslint/no-explicit-any */
type HidModule = any;

/**
 * macOS「输入监控」（TCC `kTCCServiceListenEvent`）权限的判定与指引。
 *
 * 与蓝牙不是一回事：蓝牙权限缺失时系统会自己弹窗，而「输入监控」只在**首次尝试打开键盘类 HID
 * 设备**时才弹窗并登记（弹过/拒过之后不再弹），所以这里既不需要权限库、也不需要显式请求：
 * `IOHIDDeviceOpen` 就是请求入口，失败时返回 `kIOReturnNotPermitted`(0xE00002E2)，hidapi 把
 * 它写成 `(iokit/common) not permitted`，node-hid 再把 `hid_error` 拼进抛出的错误消息 —— 按这个
 * 特征就能把「没权限」从「设备打不开」里区分出来，给出准确文案（而不是让用户面对「按键没反应」）。
 *
 * 注：`NSInputMonitoringUsageDescription` 仍保留在 `build.mac.extendInfo` 里（Apple 要求的声明位）；
 * macOS 27 实测缺这个 key 也会弹窗，但不该赌系统各版本行为一致。
 */
function isInputMonitoringDenied(error: unknown): boolean {
  // 只有 macOS 有这项 TCC 服务；其它平台的报错不该被误判成「缺输入监控权限」。
  if (process.platform !== "darwin") return false;
  const message = error instanceof Error ? error.message : String(error);
  // 0xE00002E2 是 kIOReturnNotPermitted 的裸值，mach_error_string 给的是 "(iokit/common) not permitted"。
  return /not permitted|0xe00002e2/i.test(message);
}

/** 「输入监控」缺失时的统一指引：设置页有直达按钮，且授权后必须重启才生效。 */
const INPUT_MONITORING_GUIDE =
  "请在「系统设置 → 隐私与安全性 → 输入监控」中勾选 Fello（设置页的「输入监控设置」可直接打开），" +
  "然后退出并重新打开 Fello（该权限对已运行的进程不生效）";

function matchKeyMapping(
  hid: PeripheralHidDefinition,
  report: number[],
): { keyId: string; action: "down" | "up" } | null {
  for (const mapping of hid.keyMappings) {
    if (report.length <= mapping.codeIndex) continue;
    const prefixMatches = mapping.reportPrefix.every((byte, index) => report[index] === byte);
    if (!prefixMatches) continue;
    const code = report[mapping.codeIndex];
    if (code === mapping.pressCode) return { keyId: mapping.keyId, action: "down" };
    if (code === mapping.releaseCode) return { keyId: mapping.keyId, action: "up" };
  }
  return null;
}

export function createHidTransport({ hid, onStatus, onKey }: HidTransportOptions): HidTransport {
  let handles: any[] = [];
  let startPromise: Promise<{ listening: number }> | null = null;
  const pressed = new Set<string>();
  let sawReport = false;

  async function start(): Promise<{ listening: number }> {
    if (handles.length > 0) return { listening: handles.length };
    if (startPromise) return startPromise;

    startPromise = (async () => {
      // 不做权限预检：打开设备本身就是系统弹窗 / 把 Fello 登记进「输入监控」列表的触发点
      // （首次会弹窗），权限缺失时下面的 open 会失败，按错误特征上报可操作文案。
      let permissionDenied = false;
      try {
        // 惰性加载：node-hid 缺失 / 架构不匹配时不能让宿主启动失败。
        const HID: HidModule = require("node-hid");
        const devices = await HID.devicesAsync();
        const matching = devices.filter(
          (device: any) => device.vendorId === hid.vendorId && device.productId === hid.productId,
        );
        const candidates = [
          ...new Map(
            matching
              .filter((device: any) => device.path)
              .map((device: any) => [device.path, device]),
          ).values(),
        ] as any[];

        onStatus({
          state: "enumerated",
          message: `HID 枚举：共 ${devices.length} 个设备，命中该外设 ${matching.length} 个 interface`,
          detail: `VID=0x${hid.vendorId.toString(16)} PID=0x${hid.productId.toString(16)}`,
        });

        if (candidates.length === 0) {
          onStatus({
            state: "unavailable",
            message: "未发现该外设的 HID interface（不影响蓝牙语音通道）",
          });
          return { listening: 0 };
        }

        const opened: any[] = [];
        for (const candidate of candidates) {
          try {
            const handle = await HID.HIDAsync.open(candidate.path, { nonExclusive: true });
            handle.on("data", (data: Buffer) => {
              if (!sawReport) {
                sawReport = true;
                onStatus({ state: "report-received", message: "已收到遥控器 HID 报文" });
              }
              const report = Array.from(Buffer.from(data));
              const mapped = matchKeyMapping(hid, report);
              if (!mapped) return;
              if (mapped.action === "down") {
                if (pressed.has(mapped.keyId)) return;
                pressed.add(mapped.keyId);
                onKey({ keyId: mapped.keyId, action: "down" });
              } else {
                if (!pressed.has(mapped.keyId)) return;
                pressed.delete(mapped.keyId);
                onKey({ keyId: mapped.keyId, action: "up" });
              }
            });
            handle.on("error", (error: Error) => {
              onStatus({ state: "error", message: `HID 输入错误：${error.message}` });
            });
            opened.push(handle);
            onStatus({
              state: "listening",
              message: `HID 开始监听：${candidate.path}`,
              // 打开成功不代表权限一定没问题，但这一步能确认可用：收到过报文才算真的通了。
              detail: sawReport ? undefined : `若按键无反应，${INPUT_MONITORING_GUIDE}`,
            });
          } catch (error) {
            if (isInputMonitoringDenied(error)) {
              // 权限缺失是「可操作」而不是「故障」：不逐条上报，等所有 interface 试完统一给文案。
              permissionDenied = true;
              continue;
            }
            onStatus({
              state: "error",
              message: `无法打开 HID interface：${
                error instanceof Error ? error.message : String(error)
              }`,
              detail: `若按键无反应，${INPUT_MONITORING_GUIDE}`,
            });
          }
        }

        handles = opened;
        if (permissionDenied && handles.length === 0) {
          onStatus({
            state: "permission-required",
            message: `未获得 macOS「输入监控」权限：${INPUT_MONITORING_GUIDE}`,
            detail: "没有该权限时遥控器按键不会生效；蓝牙语音通道不受影响",
          });
        } else if (handles.length === 0) {
          onStatus({
            state: "unavailable",
            message: "HID interface 无法打开（不影响蓝牙语音通道）",
            detail: `若按键无反应，${INPUT_MONITORING_GUIDE}`,
          });
        }
        return { listening: handles.length };
      } catch (error) {
        onStatus({
          state: "error",
          message: `node-hid 初始化失败：${error instanceof Error ? error.message : String(error)}`,
        });
        return { listening: 0 };
      } finally {
        startPromise = null;
      }
    })();

    return startPromise;
  }

  async function stop(): Promise<void> {
    if (startPromise) await startPromise.catch(() => {});
    const closing = handles;
    handles = [];
    pressed.clear();
    sawReport = false;
    await Promise.all(
      closing.map((handle) =>
        handle.close().catch((error: Error) => {
          onStatus({ state: "error", message: `关闭 HID 失败：${error.message}` });
        }),
      ),
    );
    if (closing.length > 0) onStatus({ state: "stopped", message: "HID 监听已停止" });
  }

  return { start, stop };
}

/** 供测试与诊断使用：纯函数形式的报文匹配。 */
export { matchKeyMapping };
