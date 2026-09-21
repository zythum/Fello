/**
 * ATVV（Audio Transmit Voice Vendor）协议常量。
 *
 * 从 xiaomi-remote-control 的 `atvv-protocol.cjs` 移植：只描述协议字节与发现条件，
 * 不执行任何 BLE 写入 —— 写入统一由 `atvv-voice.ts` 的会话层负责。
 */

/** RC003 的 ATVV 服务及三个特征。UUID 统一小写，便于与 UBM 的规范化结果比较。 */
export const ATVV_SERVICE = "ab5e0001-5a21-4f05-bc7d-af01f617b664";
export const ATVV_TRANSMIT = "ab5e0002-5a21-4f05-bc7d-af01f617b664";
export const ATVV_AUDIO = "ab5e0003-5a21-4f05-bc7d-af01f617b664";
export const ATVV_CONTROL = "ab5e0004-5a21-4f05-bc7d-af01f617b664";

export const ATVV_COMMAND = Object.freeze({
  /** 可选的遥控器初始化命令。失败时不能覆盖已经建立的 BLE 连接状态。 */
  INITIALIZE: Object.freeze([0x0a, 0x01, 0x00, 0x00, 0x03, 0x03]),
  MIC_OPEN: Object.freeze([0x0c, 0x00]),
  micClose: (sessionId: number) => Object.freeze([0x0d, sessionId & 0xff]),
});

/** RC003 可能广播服务 UUID，也可能只广播这些约定名称之一。 */
export const RC003_NAMES = Object.freeze([
  "MI RC",
  "Xiaomi Bluetooth Remote 2 Pro",
  "小米蓝牙语音遥控器",
]);

export const RC003_NAME_PREFIXES = Object.freeze(["MI RC", "Xiaomi Bluetooth Remote", "小米蓝牙"]);

/** UBM 的查询是「匹配 ATVV Service 或匹配已知名称」。 */
export const RC003_DISCOVERY_QUERY = Object.freeze({
  anyOf: Object.freeze([
    Object.freeze({ services: Object.freeze({ any: Object.freeze([ATVV_SERVICE]) }) }),
    Object.freeze({
      names: Object.freeze({ exact: RC003_NAMES, prefixes: RC003_NAME_PREFIXES }),
    }),
  ]),
});

/** ATVV Control 通知的 opcode。 */
export const ATVV_CONTROL_OPCODE = Object.freeze({
  /** 能力响应（版本 / codec / frame size）。 */
  CAPABILITIES: 0x0b,
  /** 遥控器侧的语音请求（硬件语音键被按下）。 */
  VOICE_REQUEST: 0x08,
  /** 音频开始（携带 codec 与会话 id）。 */
  AUDIO_START: 0x04,
  /** 音频停止。 */
  AUDIO_STOP: 0x00,
});
