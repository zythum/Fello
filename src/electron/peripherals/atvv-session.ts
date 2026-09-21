/**
 * 一条 RC003 的 ATVV GATT 连接（从 xiaomi-remote-control 的 `atvv-ble-session.cjs` 移植）。
 *
 * 连接过程分为「发现 → 订阅 → 原子提交」三步。只有全部完成后才把 ready 设为 true，
 * 避免半连接状态被语音按键误认为可写。
 */

import {
  ATVV_AUDIO,
  ATVV_CONTROL,
  ATVV_SERVICE,
  ATVV_TRANSMIT,
  RC003_DISCOVERY_QUERY,
} from "./xiaomi-rc003/atvv-protocol";

export type StatusPublisher = (status: { state: string; message: string }) => void;
export type ByteListener = (bytes: number[]) => void;

// UBM 未发布类型；只声明本会话真正用到的结构。
/* eslint-disable @typescript-eslint/no-explicit-any */
type UbmManager = any;
type UbmConnection = any;
type UbmSubscription = any;

export interface AtvvSessionOptions {
  getManager: () => Promise<UbmManager>;
  notifyStatus: StatusPublisher;
  /** 订阅集合是动态的：语音会话开始时才注册音频监听。 */
  controlListeners: Set<ByteListener>;
  audioListeners: Set<ByteListener>;
}

export interface AtvvConnectionInfo {
  connected: true;
  ready: true;
  name: string;
  peerId: string;
}

export interface AtvvSession {
  connect: () => Promise<AtvvConnectionInfo>;
  write: (bytes: readonly number[]) => Promise<void>;
  disconnect: () => Promise<void>;
  isReady: () => boolean;
  /** 当前连接对应的 ATVV 会话 id（由 Control 0x04 下发），未开始为 0。 */
  getSessionId: () => number;
  setSessionId: (sessionId: number) => void;
}

export function createAtvvSession({
  getManager,
  notifyStatus,
  controlListeners,
  audioListeners,
}: AtvvSessionOptions): AtvvSession {
  let connection: UbmConnection;
  let transmit: any;
  let audioSubscription: UbmSubscription;
  let controlSubscription: UbmSubscription;
  let connectionInfo: AtvvConnectionInfo | undefined;
  let generation: object | undefined;
  let connectPromise: Promise<AtvvConnectionInfo> | undefined;
  let disconnectPromise: Promise<void> | undefined;
  let ready = false;
  let sessionId = 0;

  /** 持续消费 UBM 的订阅流，并把 Control/Audio 数据转给业务监听器。 */
  async function consumeSubscription(
    subscription: UbmSubscription,
    listeners: Set<ByteListener>,
    label: string,
    owner: object,
  ) {
    try {
      for await (const event of subscription.values) {
        if (event.kind === "value") {
          const bytes = Array.from(event.value.value) as number[];
          for (const listener of [...listeners]) listener(bytes);
        } else if (event.kind === "overflow") {
          notifyStatus({
            state: "error",
            message: `${label} notification overflow: ${event.droppedItems ?? "unknown"} dropped`,
          });
        } else {
          invalidate(owner, `${label} subscription ended`);
          break;
        }
      }
    } catch (error) {
      invalidate(
        owner,
        `${label} subscription failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }

  /** 只让当前连接世代改变状态，忽略旧订阅晚到的事件。 */
  function invalidate(owner: object, message: string, isError = false) {
    if (generation !== owner) return;
    ready = false;
    transmit = undefined;
    notifyStatus({ state: isError ? "error" : "disconnected", message });
  }

  /** UBM subscription 的 remove 失败不能阻塞后续清理。 */
  async function removeSubscription(subscription: UbmSubscription | undefined) {
    if (subscription) await subscription.remove().catch(() => {});
  }

  async function cleanupAttempt(
    nextConnection: UbmConnection | undefined,
    subscriptions: Array<UbmSubscription | undefined>,
  ) {
    await Promise.all(subscriptions.map(removeSubscription));
    if (nextConnection) await nextConnection.disconnect().catch(() => {});
  }

  /** 清空当前句柄必须先于异步清理，防止新的写入撞上旧连接。 */
  function resetActiveState() {
    ready = false;
    generation = undefined;
    connectionInfo = undefined;
    connection = undefined;
    transmit = undefined;
    controlSubscription = undefined;
    audioSubscription = undefined;
    sessionId = 0;
  }

  async function releaseCurrent({ announce = false } = {}) {
    const currentConnection = connection;
    const currentSubscriptions = [controlSubscription, audioSubscription];
    const hadResources = Boolean(ready || currentConnection || currentSubscriptions.some(Boolean));

    resetActiveState();
    await cleanupAttempt(currentConnection, currentSubscriptions);

    if (announce && hadResources) {
      notifyStatus({ state: "disconnected", message: "遥控器已断开" });
    }
  }

  async function connectOnce(): Promise<AtvvConnectionInfo> {
    if (disconnectPromise) await disconnectPromise;
    if (connection || controlSubscription || audioSubscription) await releaseCurrent();

    notifyStatus({ state: "preparing", message: "正在检查 macOS CoreBluetooth 状态…" });
    const manager = await getManager();
    const adapter = await manager.adapter.waitUntilReady({ operation: "scan", timeoutMs: 10_000 });
    notifyStatus({
      state: "adapter-ready",
      message: `蓝牙已就绪：power=${adapter.power} / authorization=${adapter.authorization}`,
    });
    notifyStatus({
      state: "recovering",
      message: "正在恢复系统已连接的遥控器；若未找到则扫描 BLE 广播…",
    });
    notifyStatus({
      state: "scanning",
      message: "正在查找遥控器（优先使用系统已连接设备；未恢复时请按任意键使其广播）…",
    });

    // recovery boundary 会在 UBM scan 启动后注入系统已连接的 peripheral；
    // 如果没有恢复结果，manager.find 会继续等待普通 BLE 广播，最长 45 秒。
    const peer = await manager.find({
      query: RC003_DISCOVERY_QUERY,
      select: "first",
      timeoutMs: 45_000,
      delivery: "balanced",
    });
    notifyStatus({
      state: "found",
      message: `发现候选设备：${peer.name || peer.id} / RSSI=${peer.rssi ?? "unknown"}`,
    });
    notifyStatus({ state: "connecting", message: `正在连接：${peer.name || peer.id}` });

    let nextConnection: UbmConnection | undefined;
    let nextControlSubscription: UbmSubscription | undefined;
    let nextAudioSubscription: UbmSubscription | undefined;
    try {
      nextConnection = await manager.connect(peer, { timeoutMs: 20_000, intent: "direct" });
      notifyStatus({ state: "discovering", message: "已建立 BLE 连接，正在发现 ATVV GATT…" });
      const nextGatt = await nextConnection.discover({ timeoutMs: 20_000 });
      const nextTransmit = nextGatt.characteristic(ATVV_SERVICE, ATVV_TRANSMIT);
      const nextAudio = nextGatt.characteristic(ATVV_SERVICE, ATVV_AUDIO);
      const nextControl = nextGatt.characteristic(ATVV_SERVICE, ATVV_CONTROL);

      notifyStatus({ state: "subscribing", message: "ATVV 特征已发现，正在订阅 Control…" });
      nextControlSubscription = await nextControl.subscribe({
        delivery: "prefer-notification",
        timeoutMs: 10_000,
      });
      notifyStatus({ state: "subscribing", message: "Control 已订阅，正在订阅 Audio…" });
      nextAudioSubscription = await nextAudio.subscribe({
        delivery: "prefer-notification",
        timeoutMs: 10_000,
      });

      // 原子提交：上面任一步失败都会进入 catch，不能提前把 ready 置为 true。
      const owner = {};
      connection = nextConnection;
      transmit = nextTransmit;
      controlSubscription = nextControlSubscription;
      audioSubscription = nextAudioSubscription;
      generation = owner;
      ready = true;
      connectionInfo = {
        connected: true,
        ready: true,
        name: peer.name || "未命名设备",
        peerId: peer.id,
      };

      void consumeSubscription(controlSubscription, controlListeners, "Control", owner);
      void consumeSubscription(audioSubscription, audioListeners, "Audio", owner);
      notifyStatus({ state: "connected", message: `已连接：${peer.name || peer.id}` });
      return connectionInfo;
    } catch (error) {
      await cleanupAttempt(nextConnection, [nextControlSubscription, nextAudioSubscription]);
      throw error;
    }
  }

  async function connect(): Promise<AtvvConnectionInfo> {
    if (ready && connectionInfo) return connectionInfo;
    if (!connectPromise) {
      connectPromise = connectOnce().finally(() => {
        connectPromise = undefined;
      });
    }
    try {
      return await connectPromise;
    } catch (error) {
      const err = error as { code?: string; operation?: string; message?: string };
      const code = err?.code ? ` [${err.code}]` : "";
      const operation = err?.operation ? ` operation=${err.operation}` : "";
      notifyStatus({
        state: "error",
        message: `UBM 连接失败${code}: ${err?.message || String(error)}${operation}`,
      });
      throw error;
    }
  }

  async function write(bytes: readonly number[]): Promise<void> {
    // 语音键可能在发现 GATT 期间到达；等待同一次连接尝试完成，而不是立刻报「未连接」。
    if (connectPromise) await connectPromise;
    if (!ready || !transmit) {
      throw new Error("ATVV 尚未连接完成；请等待外设显示「已连接」");
    }
    const value = Uint8Array.from(bytes);
    const response = transmit.properties.writeWithoutResponse ? "not-required" : "required";
    return transmit.write(value, { response, timeoutMs: 10_000 });
  }

  async function disconnect(): Promise<void> {
    if (disconnectPromise) return disconnectPromise;
    disconnectPromise = (async () => {
      if (connectPromise) await connectPromise.catch(() => {});
      await releaseCurrent({ announce: true });
    })().finally(() => {
      disconnectPromise = undefined;
    });
    return disconnectPromise;
  }

  return {
    connect,
    write,
    disconnect,
    isReady: () => ready,
    getSessionId: () => sessionId,
    setSessionId: (next: number) => {
      sessionId = next;
    },
  };
}
