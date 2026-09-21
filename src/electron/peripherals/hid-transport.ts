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
 * 权限说明：macOS 10.15+ 打开键盘类 HID 需要「输入监控」权限。这里**显式请求**该权限
 * （见下方 `requestInputMonitoringAccess`），因为只调 `IOHIDDeviceOpen` 既不会弹窗、
 * 也不会把应用登记进「输入监控」列表，表现是「打开成功但永远收不到报文」。
 * 请求之外，「枚举到设备」与「收到过报文」两个事实仍用来区分「没插/没连」与「没权限」，
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
    /** macOS 缺「输入监控」权限：收不到任何报文，必须由用户去设置里授权后重启应用。 */
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
 * macOS「输入监控」（TCC `kTCCServiceListenEvent`）权限。
 *
 * 与蓝牙完全不是一回事：系统**不会**因为 `IOHIDDeviceOpen` 就弹窗，也不会把应用登记进
 * 「输入监控」列表 —— 权限缺失时 macOS 只是静默拒掉读取（系统日志里是
 * `TCC deny IOHIDDeviceOpen`），表现恰好是「打开成功但永远收不到报文」。
 * 唯一可靠的查询 / 触发方式是 Apple 的 `IOHIDCheckAccess` / `IOHIDRequestAccess`
 * （`kIOHIDRequestTypeListenEvent`）；node-hid 不会替我们调用，所以这里显式请求一次。
 *
 * 该调用还依赖 Info.plist 里的 `NSInputMonitoringUsageDescription`（见 package.json 的
 * `build.mac.extendInfo`），否则即使已在设置里勾选也可能一直返回 denied。
 *
 * 这里用 node-mac-permissions 作为 IOKit 的 JS 封装。它声明了 `os: ["darwin"]`，而 npm 对
 * **普通依赖**的平台不匹配是硬失败（EBADPLATFORM）、只有在 `optionalDependencies` 里才会
 * 静默跳过 —— 本仓库的 CI / release 会在 ubuntu、Windows 上跑 `npm ci`，所以它必须放
 * optional。代价是「缺装」不会报错，因此 macOS 上加载不到时这里显式上报 error（见下），
 * 不能让缺装退化成「按键没反应且毫无线索」。
 *
 * 下面这个联合类型是 `getAuthStatus` 的返回集合（注意是 `not determined`，不是 `unknown`）。
 */
type MacPermissionStatus = "authorized" | "denied" | "restricted" | "not determined";

interface MacPermissionsModule {
  getAuthStatus: (type: string) => MacPermissionStatus;
  askForInputMonitoringAccess: (accessType?: "listen" | "post") => Promise<MacPermissionStatus>;
}

const INPUT_MONITORING = "input-monitoring";

function loadMacPermissions(): MacPermissionsModule | null {
  // 平台判断必须早于 require：该模块只在 macOS 上存在。
  if (process.platform !== "darwin") return null;
  try {
    return require("node-mac-permissions") as MacPermissionsModule;
  } catch {
    return null;
  }
}

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

  /**
   * 请求「输入监控」权限；返回 `false` 表示当前进程收不到 HID 报文。
   *
   * 必须在打开设备**之前**调用：`IOHIDRequestAccess` 既是首次系统弹窗的来源，也是把本应用
   * 登记进「输入监控」列表的唯一可靠途径（只调 `IOHIDDeviceOpen` 在近年的 macOS 上不被登记）。
   * 用户拒绝过一次后系统不再弹窗，只能由用户去设置里勾选；而且**授权后需要退出并重新打开
   * 应用**才生效 —— 该权限对已运行的进程不生效，所以提示里必须说清这一点。
   */
  async function requestInputMonitoringAccess(): Promise<boolean | null> {
    // 非 macOS 没有这个 TCC 服务，直接跳过。
    if (process.platform !== "darwin") return null;
    const permissions = loadMacPermissions();
    if (!permissions) {
      // macOS 上「加载不到」只可能是依赖没装/没打进包 —— 必须显式报错。
      // 这条分支如果静默跳过，表现就是「按键完全没反应、且没有任何线索」，
      // 比权限不足更难排查。
      onStatus({
        state: "error",
        message: "缺少 node-mac-permissions，无法请求 macOS「输入监控」权限",
        detail: "依赖未安装或打包不完整：先 npm install，再重新打包",
      });
      return null;
    }
    try {
      const status = permissions.getAuthStatus(INPUT_MONITORING);
      if (status === "authorized") return true;
      if (status === "not determined") {
        // 首次：这一调用内部是 IOHIDRequestAccess，会弹系统对话框并把应用登记进
        // 「输入监控」列表 —— 这正是我们要的副作用。
        // 注意它的返回值不可信：node-mac-permissions 在这一支里**总是 resolve 成
        // `denied`**（系统对话框不提供「立即生效」的结果），所以只把它当注册触发器。
        await permissions.askForInputMonitoringAccess("listen").catch(() => undefined);
      }
      // denied / restricted：**不再调用 askFor** —— 它在已拒绝分支会直接打开系统设置面板，
      // 那样每次启动（每次装载通道）都会把系统设置弹出来。改为只上报状态，
      // 跳转交给设置页那个按钮由用户主动点。
      onStatus({
        state: "permission-required",
        message:
          "未获得 macOS「输入监控」权限：请在「系统设置 → 隐私与安全性 → 输入监控」中勾选 Fello，" +
          "然后退出并重新打开 Fello（该权限对已运行的进程不生效）",
        detail: "没有该权限时遥控器按键不会生效；蓝牙语音通道不受影响",
      });
      return false;
    } catch (error) {
      // 权限接口本身失败不能影响通道的其它部分（设备枚举 / 打开照常进行）。
      onStatus({
        state: "permission-required",
        message: `无法确认「输入监控」权限：${
          error instanceof Error ? error.message : String(error)
        }`,
        detail: "若按键无反应，请在「系统设置 → 隐私与安全性 → 输入监控」中授权后重启 Fello",
      });
      return null;
    }
  }

  async function start(): Promise<{ listening: number }> {
    if (handles.length > 0) return { listening: handles.length };
    if (startPromise) return startPromise;

    startPromise = (async () => {
      // 先请求 macOS「输入监控」权限（首次会弹系统对话框），再打开设备。
      // 权限不足时照旧继续枚举 / 打开：打开本身不会报错、只是收不到报文，
      // 而状态已经上报，用户据此去授权 + 重启即可。
      await requestInputMonitoringAccess();
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
              // 权限无法直接查询：只有「打开成功 + 收到过报文」才能确认可用，
              // 因此这里给出可操作的排查指引。
              detail: sawReport
                ? undefined
                : "若按键无反应，请在「系统设置 → 隐私与安全性 → 输入监控」中授权 Fello（授权后需退出并重新打开）",
            });
          } catch (error) {
            onStatus({
              state: "error",
              message: `无法打开 HID interface：${
                error instanceof Error ? error.message : String(error)
              }`,
              detail:
                "macOS 需要在「系统设置 → 隐私与安全性 → 输入监控」中授权 Fello（授权后需退出并重新打开）",
            });
          }
        }

        handles = opened;
        if (handles.length === 0) {
          onStatus({
            state: "unavailable",
            message: "HID interface 无法打开（不影响蓝牙语音通道）",
            detail:
              "macOS 需要在「系统设置 → 隐私与安全性 → 输入监控」中授权 Fello（授权后需退出并重新打开）",
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
