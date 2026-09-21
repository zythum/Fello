/**
 * 平台相关的 UBM BLE host 装配（从 xiaomi-remote-control 的 `ble-host.cjs` 移植）。
 *
 * 「选哪个 backend、要不要加 recovery 适配层」这类平台差异全部收敛在这里，
 * 上层的 ATVV 会话语义与宿主无关。
 *
 * 三个平台的 backend 都由 unified-ble-manager 提供：
 *   darwin → CoreBluetooth（UBM 包内预编译原生 addon）
 *   win32  → WinRT（UBM 包内预编译原生 addon）
 *   linux  → BlueZ D-Bus（纯 JS，需要应用自己安装 dbus-next@^0.10.2）
 *
 * ⚠️ 现状：win32 / linux 的装配分支目前**不可达** —— 内置外设（`src/shared/peripherals.ts`）
 * 只声明了 darwin 平台，在 `mount` 之前就被平台支持判定挡掉了。这两条分支是为将来要支持的
 * 外设预留的，因此 Linux 那句「npm i dbus-next@^0.10.2」只对源码运行成立，打包产物里不可操作。
 *
 * 只有 darwin 额外接 recovery 适配层，且那一层的原生查询也不在这里：
 * 它来自独立发布的 npm 包 darwin-corebluetooth-connected-peripherals-recovery
 * （darwin-only，自带 arm64/x64 prebuild，非 macOS 上 fail-closed）。
 *
 * 平台模块一律惰性 require：unified-ble-manager 的 node/bluez 在模块顶层
 * `import dbus-next`，提前加载会让 macOS/Windows 因缺少 linux 依赖而装载失败。
 */

import { createRequire } from "module";
import { ATVV_SERVICE } from "./xiaomi-rc003/atvv-protocol";
import { createRecoveryBoundary } from "./xiaomi-rc003/recovery-boundary";
import type { PeripheralStatus } from "../../shared/peripherals";

const require = createRequire(import.meta.url);

/** 受支持平台，顺序即错误信息里的展示顺序。 */
export const SUPPORTED_BLE_PLATFORMS = Object.freeze(["darwin", "win32", "linux"] as const);

// UBM 没有随包发布类型，这里只声明本模块实际用到的结构。
/* eslint-disable @typescript-eslint/no-explicit-any */
type UbmModule = any;
/** UBM 的 provider 句柄（`listAdapters()` 等）。 */
type UbmProvider = any;

function requireUbm(): UbmModule {
  return require("unified-ble-manager/electron/main");
}

interface ProviderPlan {
  platform: string;
  label: string;
  backend: string;
  noAdapterMessage: string;
  notice: string | null;
  createProvider: (context: { now: () => number; onStatus: (status: unknown) => void }) => {
    provider: UbmProvider;
    compatibility: unknown;
    recovery: unknown;
  };
}

function createDarwinProvider({
  now,
  onStatus,
}: {
  now: () => number;
  onStatus: (status: unknown) => void;
}) {
  const ubm = requireUbm();
  const recovery = require("darwin-corebluetooth-connected-peripherals-recovery");
  if (recovery.capabilities.status !== "supported") {
    throw new Error(`${recovery.capabilities.reason}；无法感知系统已连接的 RC003`);
  }

  const provider = ubm.createCoreBluetoothBackendProvider({
    boundaryFactory: () =>
      createRecoveryBoundary({
        boundary: ubm.createNativeCoreBluetoothBoundary(),
        atvvService: ATVV_SERVICE,
        // 包内有 5s 超时上限：CoreBluetooth 停在非终态时这里不会永远 pending。
        getConnectedPeripherals: () => recovery.findConnectedPeripherals([ATVV_SERVICE]),
        onRecoveryError: (error: Error) => {
          onStatus({
            state: "recovery-unavailable",
            message: `已连接遥控器恢复失败，将继续 BLE 广播扫描：${error.message}`,
          });
        },
      }),
    prepareBoundary: ubm.prepareNativeCoreBluetoothBoundary,
    now,
    hostKind: "desktop-native",
  });
  return {
    provider,
    compatibility: ubm.coreBluetoothCompatibility,
    recovery: recovery.capabilities,
  };
}

function createWinRtProvider({ now }: { now: () => number; onStatus: (status: unknown) => void }) {
  const ubm = requireUbm();
  return {
    provider: ubm.createElectronMainWinRtBackendProvider({ now }),
    compatibility: ubm.winRtCompatibility,
    recovery: null,
  };
}

function createBluezProvider({ now }: { now: () => number; onStatus: (status: unknown) => void }) {
  let ubm: UbmModule;
  try {
    ubm = require("unified-ble-manager/node/bluez");
  } catch (error) {
    throw new Error(
      `Linux 上的 BlueZ backend 需要 dbus-next@^0.10.2；请先安装：npm i dbus-next@^0.10.2。原始错误：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return {
    provider: ubm.createDbusNextBluezBackendProvider({ busKind: "system", now }),
    compatibility: ubm.bluezCompatibility,
    recovery: null,
  };
}

/**
 * 平台装配计划。
 *
 * `notice` 说的是**本 host 实际装配成什么样**，而不是「该平台是否真的需要恢复层」：
 * win32 是「同类问题但未实现」，linux 是「确实不需要」。这两个区别必须写在面向用户的
 * 文案里，免得下一个人从「没有恢复层」读成「Windows / Linux 没问题」。
 */
const PLATFORM_PLANS: Record<string, ProviderPlan> = Object.freeze({
  darwin: {
    platform: "darwin",
    label: "macOS CoreBluetooth",
    backend: "corebluetooth",
    noAdapterMessage: "没有可用的 macOS CoreBluetooth adapter",
    notice: null,
    createProvider: createDarwinProvider,
  },
  win32: {
    platform: "win32",
    label: "Windows WinRT",
    backend: "winrt",
    noAdapterMessage: "没有可用的 Windows WinRT BLE adapter",
    notice: "Windows 依赖广播扫描；已连接外设恢复未实现",
    createProvider: createWinRtProvider,
  },
  linux: {
    platform: "linux",
    label: "Linux BlueZ",
    backend: "bluez",
    noAdapterMessage: "没有可用的 BlueZ adapter",
    notice: "Linux 无需已连接外设恢复：BlueZ 会直接暴露已连接设备",
    createProvider: createBluezProvider,
  },
});

export function getPlatformBleHostPlan(platform: string = process.platform): ProviderPlan {
  const plan = PLATFORM_PLANS[platform];
  if (!plan) {
    throw new Error(
      `平台 ${platform} 没有已装配的 UBM BLE host；当前支持：${SUPPORTED_BLE_PLATFORMS.join(" / ")}`,
    );
  }
  return plan;
}

export interface PlatformBleHost {
  /**
   * **公开门面**（`createPublicBleManagerFacade`）而不是 advanced 的底层 manager。
   *
   * UBM 有两层 manager，能力差异很大：
   * - `createBleManagerFromProvider` → 底层 manager：只有 `scan` / `connect(peerId)`，
   *   GATT 走路径式 API（`write(path, bytes)`），**没有 `adapter` / `find` / `peers`**；
   * - `createPublicBleManagerFacade(core)` → 公开门面：多了 `adapter.waitUntilReady`、
   *   `find(query)`、peer 目录与「公开 GATT」（`characteristic(serviceUuid, charUuid)`）。
   *
   * xiaomi 那套 ATVV 会话语义（`adapter.waitUntilReady` → `find` → `connect(peer)` →
   * `gatt.characteristic(...)` → `subscribe(...)`）是照着**门面**写的 —— 因为原程序的
   * 会话跑在 preload 里，通过 UBM 的 IPC router 拿到的就是门面。所以在主进程直接使用
   * 底层 manager 会立刻报 `adapter is undefined`。
   *
   * 门面的 `destroy()` 会先停掉自己的 scan session，再调用底层 manager 的 destroy，
   * 因此清理只需要调用这一层。
   */
  manager: UbmModule;
  provider: unknown;
  platform: string;
  label: string;
  backend: string;
  adapterId: string;
  recovery: unknown;
}

export interface CreatePlatformBleHostOptions {
  now: () => number;
  managerIdentity: { clientId: string; managerId: string; ownerMode: string };
  onStatus?: (status: unknown) => void;
  platform?: string;
}

/**
 * 按平台装配 UBM BLE host，并返回已经 attach 好的 manager。
 *
 * 失败一律 fail-closed：没有可用 backend、没有 adapter 或缺少平台依赖时直接抛错，
 * 不会退回到模拟 radio 或另一个 backend（宿主只需把错误显示成外设不可用）。
 */
export async function createPlatformBleHost({
  now,
  managerIdentity,
  onStatus = () => {},
  platform = process.platform,
}: CreatePlatformBleHostOptions): Promise<PlatformBleHost> {
  const plan = getPlatformBleHostPlan(platform);
  if (plan.notice) console.log(`[peripheral:ble] ${plan.notice}`);

  const {
    createBleManagerFromProvider,
    createPublicBleManagerFacade,
    DEFAULT_BLE_MANAGER_OPTIONS,
  } = require("unified-ble-manager/advanced");
  const { provider, compatibility, recovery } = plan.createProvider({ now, onStatus });

  const adapters = await provider.listAdapters();
  if (!adapters[0]) throw new Error(plan.noAdapterMessage);

  // 这里使用 UBM 的底层装配 API，所以要显式给出 manager 身份与兼容性声明。
  const coreManager = await createBleManagerFromProvider(
    {
      provider,
      selection: { selectedAdapterId: adapters[0].adapterId },
      coreCompatibility: compatibility,
      manager: managerIdentity,
    },
    { ...DEFAULT_BLE_MANAGER_OPTIONS, now },
  );

  // 对外只暴露公开门面：ATVV 会话语义依赖 `adapter` / `find` 与公开 GATT（见上方注释）。
  const manager = await createPublicBleManagerFacade(coreManager, now);

  return {
    manager,
    provider,
    platform: plan.platform,
    label: plan.label,
    backend: plan.backend,
    adapterId: adapters[0].adapterId,
    recovery,
  };
}

/**
 * 把通道上报的原始状态归一成**连接状态**；纯信息类状态返回 `null`。
 *
 * 返回 null 的那些（ATVV 能力响应、开关麦、遥控器语音请求、提示等）只是日志性事件，
 * 必须由调用方**保留当前 phase**：早先它们一律落到 `default: "preparing"`，结果连接成功后
 * 一条「ATVV 能力：codec 0x2 / 16000 Hz…」就把「已连接」顶回「准备中」了。
 */
export function normalizeBlePhase(state: string): PeripheralStatus["phase"] | null {
  switch (state) {
    case "connected":
      return "connected";
    case "error":
      return "error";
    case "unavailable":
    case "recovery-unavailable":
      return "unavailable";
    case "scanning":
    case "recovering":
    case "found":
      return "scanning";
    case "connecting":
    case "discovering":
    case "subscribing":
      return "connecting";
    case "preparing":
    case "adapter-ready":
      return "preparing";
    case "disconnected":
      // 链路断了，但外设仍然是「生效」的（开关为 ON）：不能用 inactive，否则文案自相矛盾。
      return "disconnected";
    default:
      // capabilities / mic-open / mic-closed / voice-request / notice …
      return null;
  }
}
