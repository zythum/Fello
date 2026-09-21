/**
 * 把「系统已连接外设恢复」适配成 UBM 能理解的扫描事件。
 *
 * 背景（UBM 4.0.27，证据见 xiaomi-remote-control/docs/atvv-remote-package-decision.md §3）：
 * macOS 的 CoreBluetooth 没有 connected-peripherals API，而 IOHIDFamily 会维持 RC003 的
 * BLE HID 链路，所以它被系统连上后就不再广播，普通扫描永远扫不到。UBM 的 peer registry
 * 又只能由 advertisement 铸造（`connect(peerId)` 的 peerId 是不透明内部 id，无法用
 * CoreBluetooth UUID 构造）。因此唯一可行路径是：把查询到的已连接外设**合成一条
 * advertisement** 注入 scan，后续 connect / discover / subscribe 仍全部交给 UBM。
 *
 * 本文件从 `connected-peripheral-recovery-boundary.cjs` 移植，只做 boundary 包装，
 * 不做配对、不碰 GATT，也不使用系统显示的蓝牙 MAC 地址。
 */

/** UBM native boundary 中本适配层需要转发的方法。 */
interface NativeBoundary {
  startScan(
    onAdvertisement: (advertisement: unknown) => void,
    serviceUuids?: unknown,
    deviceAddresses?: unknown,
    platform?: unknown,
  ): Promise<unknown>;
  stopScan(): Promise<unknown>;
  destroy(): Promise<unknown>;
}

interface ConnectedPeripheral {
  id: string;
  name?: string | null;
}

export interface RecoveryBoundaryOptions {
  boundary: NativeBoundary;
  getConnectedPeripherals: () => Promise<ConnectedPeripheral[]>;
  atvvService: string;
  onRecoveryError?: (error: Error) => void;
  schedule?: (callback: () => void, delayMs: number) => unknown;
}

export function createRecoveryBoundary({
  boundary,
  getConnectedPeripherals,
  atvvService,
  onRecoveryError = () => {},
  schedule = setTimeout,
}: RecoveryBoundaryOptions): NativeBoundary {
  // 每次开始/停止扫描都会推进 epoch，丢弃已经过期的异步恢复结果。
  let scanEpoch = 0;
  let destroyed = false;

  const isCurrentScan = (epoch: number) => !destroyed && epoch === scanEpoch;

  const toRecoveredAdvertisement = (peripheral: ConnectedPeripheral) => {
    if (typeof peripheral?.id !== "string" || peripheral.id.length === 0) return null;
    return {
      nativePeerId: peripheral.id,
      localName: typeof peripheral.name === "string" ? peripheral.name : null,
      // 系统恢复结果没有广播 RSSI / 原始包；这些字段必须保持未知，而不是伪造数值。
      rssi: null,
      serviceUuids: [atvvService],
      solicitedServiceUuids: [],
      overflowServiceUuids: [],
      serviceData: [],
      manufacturerData: [],
      txPower: null,
      connectable: true,
      appearance: null,
      rawRecord: null,
      scanResponseRecord: null,
    };
  };

  const emitConnectedPeripherals = async (
    epoch: number,
    onAdvertisement: (advertisement: unknown) => void,
  ) => {
    try {
      const peripherals = await getConnectedPeripherals();
      if (!isCurrentScan(epoch)) return;
      for (const peripheral of peripherals) {
        const advertisement = toRecoveredAdvertisement(peripheral);
        if (advertisement) onAdvertisement(advertisement);
      }
    } catch (error) {
      if (isCurrentScan(epoch))
        onRecoveryError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return {
    ...boundary,

    async startScan(onAdvertisement, serviceUuids, deviceAddresses, platform) {
      const epoch = scanEpoch + 1;
      scanEpoch = epoch;
      await boundary.startScan(onAdvertisement, serviceUuids, deviceAddresses, platform);

      // UBM 在 startScan resolve 后才会把 scan group 标记为 active。
      // 延迟一个事件循环再注入，避免恢复事件在 scan 尚未登记时丢失。
      schedule(() => void emitConnectedPeripherals(epoch, onAdvertisement), 0);
    },

    async stopScan() {
      scanEpoch += 1;
      return boundary.stopScan();
    },

    async destroy() {
      destroyed = true;
      scanEpoch += 1;
      return boundary.destroy();
    },
  };
}
