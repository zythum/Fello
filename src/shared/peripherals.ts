/**
 * 外设（Peripheral）描述符 —— 内置枚举的唯一事实源。
 *
 * 设计约定：
 * 1. **内置枚举**：外设列表由代码写死（`BUILTIN_PERIPHERALS`），不做动态发现后的注册；
 *    运行时只负责“按描述符装配通道 + 上报状态”。
 * 2. **数据而非函数**：这里只放可序列化的数据，main 与 renderer 都能直接 import，
 *    不需要通过 IPC 传递描述符。
 * 3. **通道按外设声明**：蓝牙 / HID / USB 是通道，不是外设类型。一个外设可以同时用到
 *    多个通道（小米遥控器 = 键盘事件 + HID 报文 + BLE ATVV 音频）。
 * 4. **HID 只做按键映射**：不同设备的 HID 报文编码不一样，因此映射写在描述符里；
 *    通道层不出现任何设备特判。
 * 5. **仅 Electron 生效**：WebUI 下不装载运行时（见 `isPeripheralRuntimeAvailable`），
 *    设置页只做只读展示。
 */

/** 外设用到的传输通道。 */
export type PeripheralTransport = "keyboard" | "hid" | "bluetooth";

/** 外设按键的按下语义：单击（press）还是按住（hold）。 */
export type PeripheralKeyKind = "press" | "hold";

/**
 * 一个外设按键。
 *
 * - `systemKey`：按键在宿主里最终表现成的系统按键（由 renderer 注入或直接依赖系统派发）。
 *   例如小米遥控器的「返回」在 HID 上报里是私有编码，但语义上等价于 `Escape`。
 * - `code`：外设按键已经被系统派发成 KeyboardEvent 时对应的 `event.code`
 *   （例如语音键 = `F5`）。这类按键不需要 HID 层参与，也不需要注入。
 */
export interface PeripheralKeyDefinition {
  id: string;
  /** i18n key 后缀，文案统一在 `settings.peripherals.keys.<id>` 下。 */
  labelKey: string;
  transport: PeripheralTransport;
  kind: PeripheralKeyKind;
  /** 系统派发的 KeyboardEvent.code（transport = "keyboard" 时必填）。 */
  code?: string;
  /**
   * 该按键要注入的系统按键（transport = "hid" 时必填）。
   * 设置页在 `hid` 通道下也用它做展示（键盘事件才有 `code` 可展示）。
   *
   * **约束：必须与 `KeyboardEvent.code` 同名**（例如 `Escape`）。渲染层注入时把它
   * 同时用作 `key` 与 `code`，因此映射到 `Enter` / `Backspace` 这类 key ≠ code 的键之前，
   * 必须先给渲染层补一层 { key, code } 映射。
   */
  systemKey?: string;
}

/**
 * HID 报文里一段按键字段的映射规则（设备私有编码）。
 *
 * 小米遥控器的实测布局：报文形如 `01 00 00 XX ...`，第 3 字节 `0xF1` = 返回键按下，
 * 回到 `0x00` = 释放。这类编码是设备私有的（实测确认不是标准 Consumer AC Back `0x0224`），
 * 所以必须按设备声明，且必须允许“对不上就什么都不做”。
 */
export interface HidKeyMapping {
  keyId: string;
  /** 报文前缀（逐字节相等才算命中）。 */
  reportPrefix: readonly number[];
  /** 按键字段在报文里的下标。 */
  codeIndex: number;
  /** 按下时该字段的取值。 */
  pressCode: number;
  /** 释放时该字段的取值。 */
  releaseCode: number;
}

/** HID 通道的匹配与映射规则。 */
export interface PeripheralHidDefinition {
  vendorId: number;
  productId: number;
  keyMappings: readonly HidKeyMapping[];
}

/** BLE 通道声明：当前只用于 ATVV 语音（麦克风）链路。 */
export interface PeripheralBluetoothDefinition {
  /** 通道实现 id，运行时按它选择对应的 BLE 装配（目前只有 `atvv-voice`）。 */
  kind: "atvv-voice";
  /** 语音输入格式，供上层与 ASR 对齐（ATVV 解码后即为此格式，无需重采样）。 */
  audio: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
  };
}

/** 平台支持：不在列表里的平台一律“不可生效”，且不尝试装载任何通道。 */
export type PeripheralPlatform = "darwin" | "win32" | "linux";

export interface PeripheralDescriptor {
  id: string;
  /** 展示名（品牌 / 型号，不透传成 i18n，属于专有名词）。 */
  name: string;
  /**
   * 商品 / 产品页链接（可选，专有名词性质的 URL，不进 i18n）。
   * 只在设置页展示，供用户核对型号或购买；运行时逻辑不读它。
   */
  productUrl?: string;
  platforms: readonly PeripheralPlatform[];
  /**
   * 连接状态的展示文案 i18n key 后缀。不同外设“已连接”的含义不同
   * （蓝牙设备 = 蓝牙已连接；USB 设备可能是枚举到接口），所以由外设自己声明，
   * 只用于给用户确认，不参与任何门禁逻辑。
   */
  statusLabelKey: string;
  keys: readonly PeripheralKeyDefinition[];
  hid?: PeripheralHidDefinition;
  bluetooth?: PeripheralBluetoothDefinition;
}

/** 小米蓝牙语音遥控器 RC003。 */
export const XIAOMI_RC003: PeripheralDescriptor = {
  id: "xiaomi-rc003",
  name: "Xiaomi Bluetooth Remote 2 Pro (RC003)",
  productUrl: "https://www.mi.com/xiaomi-bluetooth-remote-2-pro",
  platforms: ["darwin"],
  statusLabelKey: "settings.peripherals.status.bluetooth",
  keys: [
    {
      id: "voice",
      labelKey: "settings.peripherals.keys.voice",
      transport: "keyboard",
      kind: "hold",
      code: "F5",
    },
    {
      id: "back",
      labelKey: "settings.peripherals.keys.back",
      // 走 HID 报文（设备私有编码，见下方 `hid.keyMappings`）→ 注入系统按键，
      // 不是系统直接派发的键盘事件，所以没有 `code`。
      transport: "hid",
      kind: "press",
      // 注意：**这个字段不能删** —— 它是「HID 报文 → 注入系统按键」的唯一开关：
      // index.ts 把它塞进 peripheral-key 事件，渲染层 `if (!event.systemKey) return;`
      // 一旦为空就静默丢弃（按键没反应、也没有任何报错）。
      systemKey: "Escape",
    },
  ],
  hid: {
    vendorId: 0x2717,
    productId: 0x32b8,
    keyMappings: [
      {
        keyId: "back",
        reportPrefix: [0x01, 0x00, 0x00],
        codeIndex: 3,
        pressCode: 0xf1,
        releaseCode: 0x00,
      },
    ],
  },
  bluetooth: {
    kind: "atvv-voice",
    audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
  },
};

/** 内置外设列表（顺序即设置页展示顺序）。 */
export const BUILTIN_PERIPHERALS: readonly PeripheralDescriptor[] = [XIAOMI_RC003];

export function getPeripheralDescriptor(id: string): PeripheralDescriptor | null {
  return BUILTIN_PERIPHERALS.find((peripheral) => peripheral.id === id) ?? null;
}

/** 当前平台是否被该外设支持（不支持的设备在设置页置灰，且不装载任何通道）。 */
export function isPeripheralSupportedOnPlatform(
  peripheral: PeripheralDescriptor,
  platform: string,
): boolean {
  return peripheral.platforms.includes(platform as PeripheralPlatform);
}

/**
 * 外设运行时是否可用。
 *
 * WebUI（浏览器 / 无 preload）与 headless server 都不允许装载外设运行时：
 * 前者没有 node 能力，后者不该被 25MB 的 BLE 栈与原生模块污染。
 */
export function isPeripheralRuntimeAvailable(options: {
  isWebUI: boolean;
  platform: string;
}): boolean {
  if (options.isWebUI) return false;
  return BUILTIN_PERIPHERALS.some((peripheral) =>
    isPeripheralSupportedOnPlatform(peripheral, options.platform),
  );
}

/** 单条外设的持久化设置（“生效”开关）。 */
export interface PeripheralSettingInfo {
  id: string;
  /** 生效 = 装载该外设的按键 / 音频逻辑；已连接只用于展示。 */
  enabled: boolean;
}

/** 外设的运行时状态（仅展示，不参与门禁）。 */
export type PeripheralPhase =
  /** 未生效：用户没打开这个外设的开关。 */
  | "inactive"
  /** 已生效但链路断开（遥控器走远 / 休眠 / 蓝牙被关）。与 `inactive` 必须区分，否则开关是 ON 却显示「未生效」。 */
  | "disconnected"
  | "unsupported"
  | "unavailable"
  | "preparing"
  | "scanning"
  | "connecting"
  | "connected"
  | "error";

export interface PeripheralStatus {
  id: string;
  phase: PeripheralPhase;
  /** 面向用户的状态详情（通道上报的原始文案，如蓝牙恢复/扫描进度）。 */
  message?: string;
  /** 通道级补充信息（HID 权限、连接名称等），仅供设置页展示。 */
  detail?: string;
  /** 最近一次更新时间。 */
  updatedAt: number;
}
