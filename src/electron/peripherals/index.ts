/**
 * 外设宿主（Electron 主进程）。
 *
 * 职责边界：
 * - 按**内置描述符**装配通道（HID / 蓝牙），不做动态注册；
 * - 只处理「生效」开关的装载/卸载与状态上报，不做任何 UI 决策；
 * - 与 Fello 其它模块的唯一接口是 `publish`（状态 / 按键 / 音频帧）；
 * - 任何通道失败都只上报状态，**不阻塞宿主启动**；headless server 永远不加载本模块。
 *
 * 「生效」与「已连接」是两件事：生效 = 装载该外设的特殊逻辑（按键绑定、语音通道），
 * 已连接只用于给用户确认。因此这里不会因为没连上就拒绝装载。
 */

import {
  BUILTIN_PERIPHERALS,
  getPeripheralDescriptor,
  isPeripheralSupportedOnPlatform,
  type PeripheralDescriptor,
  type PeripheralStatus,
} from "../../shared/peripherals";
import { createAtvvVoiceChannel, type AtvvVoiceChannel } from "./atvv-voice";
import { createPlatformBleHost, normalizeBlePhase, type PlatformBleHost } from "./ble-host";
import { createHidTransport, type HidTransport } from "./hid-transport";

/**
 * 装配 UBM host 的超时上限（见 `assembleBleHost`）。
 *
 * 15 秒足够 CoreBluetooth 完成常规装配；若真机上偶发更慢，可以调大，但**不要去掉** ——
 * 没有上界时，蓝牙未开启 / 未授权会表现为设置页永远「准备中」且无法重试。
 */
const BLE_HOST_TIMEOUT_MS = 15_000;

/**
 * 一次「连接」的整体上界。
 *
 * 会话内部每步都有自己的 deadline（等待 adapter 10s、扫描 45s、连接/发现 20s、订阅 10s），
 * 正常失败会在几十秒内落到「错误」。但 UBM 更内层（如 CoreBluetooth 状态流不吐值）卡住时，
 * 外层就永远等不到结果 —— 那样设置页会一直停在「准备中」，用户既看不到原因也无法重试。
 * 这里给 70s（> 45s 扫描 + 余量）作为出口；超时后底层若稍后自己连上，状态会自然纠正。
 */
const CONNECT_TIMEOUT_MS = 70_000;

/** 给一个 Promise 加上界；超时抛出的错误会带上可操作的建议。 */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface PeripheralKeyPayload {
  peripheralId: string;
  keyId: string;
  action: "down" | "up";
  systemKey?: string;
}

export interface PeripheralHostPublisher {
  status: (status: PeripheralStatus) => void;
  key: (event: PeripheralKeyPayload) => void;
  audio: (event: { peripheralId: string; captureId: number; audioB64: string }) => void;
  audioState: (event: {
    peripheralId: string;
    state: "started" | "stopped";
    captureId: number;
    reason?: string;
  }) => void;
}

export interface PeripheralHost {
  /** 按设置里的「生效」列表同步装载状态（幂等）。 */
  syncEnabled: (enabledIds: readonly string[]) => Promise<void>;
  /** 手动连接（设置页的「重新连接」重试入口）。 */
  connect: (peripheralId: string) => Promise<void>;
  /** @returns 本次采集的 captureId（渲染层用它过滤属于上一次采集的迟到音频）。 */
  startVoice: (peripheralId: string) => Promise<number>;
  stopVoice: (peripheralId: string) => Promise<void>;
  getStatuses: () => PeripheralStatus[];
  destroy: () => Promise<void>;
}

interface MountedPeripheral {
  descriptor: PeripheralDescriptor;
  hid?: HidTransport;
  voice?: AtvvVoiceChannel;
  connectPromise?: Promise<void>;
  /**
   * 已卸载。
   *
   * 卸载后置位，所有异步回调（连接进度、HID 报文、音频）都据此**不再回写宿主状态** ——
   * 否则「关掉开关」之后一条迟到的连接失败会把卡片从「未生效」改成「错误」，
   * 而后续 sync 看到状态已存在、不会再纠正它。
   */
  removed: boolean;
}

export interface CreatePeripheralHostOptions {
  publish: PeripheralHostPublisher;
  platform?: string;
}

export function createPeripheralHost({
  publish,
  platform = process.platform,
}: CreatePeripheralHostOptions): PeripheralHost {
  const mounted = new Map<string, MountedPeripheral>();
  const statuses = new Map<string, PeripheralStatus>();
  let bleHostPromise: Promise<PlatformBleHost> | null = null;
  let destroyed = false;

  function setStatus(
    descriptor: PeripheralDescriptor,
    phase: PeripheralStatus["phase"],
    message?: string,
    detail?: string,
  ) {
    const status: PeripheralStatus = {
      id: descriptor.id,
      phase,
      message,
      detail,
      updatedAt: Date.now(),
    };
    const previous = statuses.get(descriptor.id);
    statuses.set(descriptor.id, status);
    // 终端只跟「阶段」变化：同阶段的进度 / 详情刷新（HID 枚举、ATVV 能力、开关麦克风…）不再逐条打印，
    // 否则光按一次语音键就要刷好几行。错误例外 —— 换了新的错误文案仍要打出来。
    if (previous?.phase !== phase || (phase === "error" && previous?.message !== message)) {
      console.log(`[peripheral] ${descriptor.id} → ${phase}${message ? ` · ${message}` : ""}`);
    }
    publish.status(status);
  }

  /** UBM host 是重资源（25MB 的 BLE 栈），只在真正需要时惰性装配一次。 */
  function getBleHost(): Promise<PlatformBleHost> {
    if (!bleHostPromise) {
      bleHostPromise = assembleBleHost().catch((error) => {
        // 失败不缓存：下一次生效 / 点「重新连接」可以重试。
        bleHostPromise = null;
        throw error;
      });
    }
    return bleHostPromise;
  }

  /**
   * 带超时地装配 UBM host。
   *
   * `createPlatformBleHost` 内部的 `provider.listAdapters()` 与 attach 握手是**唯一不自带
   * deadline 的等待**：CoreBluetooth 若停在「等待蓝牙授权」「蓝牙未开启」这类非终态，
   * 它可能一直不 resolve —— 表现就是设置页永远停在「准备中」，且没有任何可操作信息。
   * 所以这里给它一个上界，超时走正常错误路径（用户可点「重新连接」重试）。
   */
  async function assembleBleHost(): Promise<PlatformBleHost> {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = createPlatformBleHost({
      now: () => performance.now(),
      managerIdentity: {
        clientId: "fello-electron-main",
        managerId: "fello-electron-main-peripherals",
        ownerMode: "owning",
      },
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(
          new Error(
            `蓝牙后端装配超时（${BLE_HOST_TIMEOUT_MS / 1000} 秒）：请确认系统蓝牙已开启，` +
              `并已在「系统设置 → 隐私与安全性 → 蓝牙」中允许本应用；之后可点「重新连接」重试`,
          ),
        );
      }, BLE_HOST_TIMEOUT_MS);
    });

    try {
      const host = await Promise.race([attempt, timeout]);
      if (timer) clearTimeout(timer);
      // 装配成功后只留这一行（装配耗时由调用方的状态上报覆盖，这里记下 backend / adapter 供排障）。
      console.log(`[peripheral] BLE host 就绪：${host.label} / adapter=${host.adapterId}`);
      return host;
    } catch (error) {
      if (timer) clearTimeout(timer);
      console.error(
        `[peripheral] BLE host 装配失败：${error instanceof Error ? error.message : String(error)}`,
      );
      // 超时之后底层仍可能慢慢成功：那时把它销毁，别留一个孤儿 manager 占着蓝牙 radio。
      void attempt
        .then((host) => {
          if (timedOut) void host.manager?.destroy?.().catch(() => {});
        })
        .catch(() => {});
      throw error;
    }
  }

  async function ensureConnected(entry: MountedPeripheral, reason: string): Promise<void> {
    if (!entry.voice) throw new Error("该外设没有音频通道");
    if (entry.voice.isReady()) return;
    if (entry.connectPromise) return entry.connectPromise;

    entry.connectPromise = (async () => {
      if (entry.removed) return;
      setStatus(entry.descriptor, "preparing", "正在装配蓝牙后端（首次需要几秒）…");
      const host = await getBleHost();
      if (entry.removed) return;
      setStatus(entry.descriptor, "preparing", `蓝牙后端已就绪：${host.label}`);
      // connect 内部有各自的 deadline（等待 adapter 10s / 扫描 45s / 连接与订阅各若干秒），
      // 但 UBM 更内层若卡死，外面就永远等不到结果 —— 所以再套一层整体上界。
      await withTimeout(
        entry.voice!.connect(),
        CONNECT_TIMEOUT_MS,
        `连接遥控器超时（${CONNECT_TIMEOUT_MS / 1000} 秒）：请确认遥控器已唤醒、` +
          `且在系统蓝牙中仍处于已配对状态；之后可点「重新连接」重试`,
      );
    })()
      .catch((error) => {
        if (!entry.removed) {
          setStatus(
            entry.descriptor,
            "error",
            `连接失败：${error instanceof Error ? error.message : String(error)}`,
            reason,
          );
        }
        throw error;
      })
      .finally(() => {
        entry.connectPromise = undefined;
      });

    return entry.connectPromise;
  }

  async function mount(descriptor: PeripheralDescriptor) {
    if (mounted.has(descriptor.id)) return;
    const entry: MountedPeripheral = { descriptor, removed: false };
    mounted.set(descriptor.id, entry);
    /** 卸载之后所有异步回调都不再回写宿主状态（见 `MountedPeripheral.removed`）。 */
    const alive = () => !entry.removed;

    // HID 通道：只做按键映射。失败只上报，不影响蓝牙。
    if (descriptor.hid) {
      entry.hid = createHidTransport({
        hid: descriptor.hid,
        onStatus: (status) => {
          if (!alive()) return;
          const previous = statuses.get(descriptor.id);
          // 只有「通道不可用 / 出错 / 缺权限」才配改状态；枚举、开始监听、收到报文这类进度
          // 写进详情行即可 —— 否则每按一次键都会把「已连接」的文案顶掉。
          if (status.state === "error" || status.state === "unavailable") {
            setStatus(descriptor, status.state, status.message, status.detail);
            return;
          }
          if (status.state === "permission-required") {
            // 「缺权限」不是状态机的 phase，按「通道不可用」呈现：文案由通道给出，
            // 且后续的枚举 / 监听进度只会改详情行，不会顶掉这条可操作的提示。
            // 用户授权并重启后，通道会重新装载并直接打开设备成功。
            setStatus(descriptor, "unavailable", status.message, status.detail);
            return;
          }
          setStatus(
            descriptor,
            previous?.phase ?? "preparing",
            previous?.message,
            status.detail ?? status.message,
          );
        },
        onKey: (event) => {
          if (!alive()) return;
          const key = descriptor.keys.find((candidate) => candidate.id === event.keyId);
          publish.key({
            peripheralId: descriptor.id,
            keyId: event.keyId,
            action: event.action,
            systemKey: key?.systemKey,
          });
        },
      });
      void entry.hid.start();
    }

    // 蓝牙通道：ATVV 语音。连接是慢操作（恢复 / 最长 45s 扫描），不阻塞生效。
    if (descriptor.bluetooth) {
      entry.voice = createAtvvVoiceChannel({
        getManager: () => getBleHost().then((host) => host.manager),
        onStatus: (status) => {
          if (!alive()) return;
          const previous = statuses.get(descriptor.id);
          const phase = normalizeBlePhase(status.state);
          if (phase === null) {
            // 纯信息类（能力响应 / 开关麦 / 语音请求 / 提示）：只写详情行，
            // 保留连接状态与状态文案 —— 否则「已连接」会被这类事件顶掉。
            setStatus(
              descriptor,
              previous?.phase ?? "preparing",
              previous?.message,
              status.message,
            );
            return;
          }
          setStatus(descriptor, phase, status.message, previous?.detail);
        },
        onAudio: (pcm, captureId) => {
          if (!alive()) return;
          publish.audio({
            peripheralId: descriptor.id,
            captureId,
            audioB64: Buffer.from(pcm).toString("base64"),
          });
        },
        onAudioState: (state, captureId, reason) => {
          if (!alive()) return;
          publish.audioState({ peripheralId: descriptor.id, state, captureId, reason });
        },
      });
      void ensureConnected(entry, "自动连接").catch(() => {
        // ensureConnected 已经上报状态；这里只吞掉 rejection，避免未处理异常。
      });
    }
  }

  async function unmount(descriptor: PeripheralDescriptor) {
    const entry = mounted.get(descriptor.id);
    if (!entry) return;
    mounted.delete(descriptor.id);
    // 先置 `removed` 再收尾：卸载期间到达的连接进度 / 错误 / 音频一律丢弃，
    // 状态也立刻落到「未生效」，不必等一次 45s 级的连接收尾跑完。
    entry.removed = true;
    setStatus(descriptor, "inactive", "已停用");
    await entry.hid?.stop().catch(() => {});
    await entry.voice?.disconnect().catch(() => {});
  }

  async function syncEnabled(enabledIds: readonly string[]) {
    if (destroyed) return;
    const enabled = new Set(enabledIds);
    for (const descriptor of BUILTIN_PERIPHERALS) {
      const supported = isPeripheralSupportedOnPlatform(descriptor, platform);
      if (!supported) {
        if (statuses.get(descriptor.id)?.phase !== "unsupported") {
          setStatus(descriptor, "unsupported", "当前平台不支持该外设");
        }
        continue;
      }
      if (enabled.has(descriptor.id)) {
        await mount(descriptor);
      } else if (mounted.has(descriptor.id)) {
        await unmount(descriptor);
      } else if (!statuses.has(descriptor.id)) {
        setStatus(descriptor, "inactive", "未生效");
      }
    }
  }

  function requireEntry(peripheralId: string): MountedPeripheral {
    const descriptor = getPeripheralDescriptor(peripheralId);
    if (!descriptor) throw new Error(`未知外设：${peripheralId}`);
    const entry = mounted.get(peripheralId);
    if (!entry) throw new Error(`${descriptor.name} 未生效，请先在设置中启用`);
    return entry;
  }

  return {
    syncEnabled,

    async connect(peripheralId: string) {
      await ensureConnected(requireEntry(peripheralId), "手动连接");
    },

    async startVoice(peripheralId: string) {
      const entry = requireEntry(peripheralId);
      const voice = entry.voice;
      if (!voice) throw new Error("该外设没有音频通道");
      if (!voice.isReady()) {
        // 语音链路没准备好时不要把错误吞掉：渲染层据此提示用户。
        await ensureConnected(entry, "开始语音采集");
      }
      return voice.startCapture();
    },

    async stopVoice(peripheralId: string) {
      await mounted.get(peripheralId)?.voice?.stopCapture();
    },

    getStatuses: () =>
      BUILTIN_PERIPHERALS.map((descriptor) => statuses.get(descriptor.id)).filter(
        (status): status is PeripheralStatus => Boolean(status),
      ),

    async destroy() {
      destroyed = true;
      for (const entry of [...mounted.values()]) {
        // 退出中：同样先掐掉回调，别在拆除阶段还往外发状态。
        entry.removed = true;
        await entry.hid?.stop().catch(() => {});
        await entry.voice?.disconnect().catch(() => {});
      }
      mounted.clear();
      if (bleHostPromise) {
        const host = await bleHostPromise.catch(() => null);
        await host?.manager?.destroy?.().catch(() => {});
        bleHostPromise = null;
      }
    },
  };
}
