/**
 * IMA/DVI ADPCM 解码（高半字节优先）。
 *
 * 从 xiaomi-remote-control 的 `atvv-adpcm.mjs` 移植：ATVV Audio 通知里的每个字节
 * 携带两个 4-bit 采样，解码输出即 16 kHz / 16-bit / mono PCM —— 与 Fello 的 ASR
 * 上行格式一致，因此不需要任何重采样。
 */

const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1876, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8];

export class ImaAdpcmDecoder {
  private predictor = 0;

  private index = 0;

  constructor(private readonly lowNibbleFirst = false) {
    this.reset();
  }

  reset(predictor = 0, index = 0) {
    this.predictor = Math.max(-32768, Math.min(32767, predictor | 0));
    this.index = Math.max(0, Math.min(88, index | 0));
  }

  decode(bytes: Uint8Array): Int16Array {
    const samples = new Int16Array(bytes.length * 2);
    let output = 0;

    for (const byte of bytes) {
      const first = this.lowNibbleFirst ? byte & 0x0f : byte >> 4;
      const second = this.lowNibbleFirst ? byte >> 4 : byte & 0x0f;
      output = this.decodeNibble(first, samples, output);
      output = this.decodeNibble(second, samples, output);
    }
    return samples;
  }

  private decodeNibble(code: number, output: Int16Array, offset: number): number {
    const step = STEP_TABLE[this.index];
    let difference = step >> 3;
    if (code & 1) difference += step >> 2;
    if (code & 2) difference += step >> 1;
    if (code & 4) difference += step;
    this.predictor += code & 8 ? -difference : difference;
    this.predictor = Math.max(-32768, Math.min(32767, this.predictor));
    this.index += INDEX_TABLE[code & 7];
    this.index = Math.max(0, Math.min(88, this.index));
    output[offset] = this.predictor;
    return offset + 1;
  }
}
