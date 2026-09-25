import removeMd from "remove-markdown";

/**
 * 流式文本 → TTS 分句。
 *
 * 只做两件事：
 * 1. **把 markdown 还原成自然语言文本**：`remove-markdown` 去掉链接 / 图片 / 强调 /
 *    标题 / 引用 / 脚注 / HTML 标签等标记；代码围栏整块丢弃（读代码是体验灾难）；
 *    它漏掉的零星标记（未成对的星号、下划线、反引号）、表格竖线、任务框、裸 URL 与零宽字符在这里补一刀。
 * 2. **不把 provider 会拒收的输入发出去**：DashScope 对「没有任何可朗读字符」的输入返回
 *    `InvalidParameter: Please ensure input text is valid.`（实测 `：` / `.` / `—` /
 *    单空格 / `--- ---` 均被拒），因此每一句都要求至少含一个字母 / 数字 / CJK。
 *
 * **文本内容本身不做任何解读**：数学公式、运算符、emoji、URL、语种、大小写都原样交给
 * TTS 引擎（各家自带文本归一化与发音规则）。我们不猜语言、不改写读法——中英混排时自己
 * 插「加 / 等于」只会读错，交给引擎更稳。
 *
 * 有状态的增量切分器：调用方按到达顺序 `feed()` 任意长度的原始文本块，每次拿到可立即
 * 合成的完整句子；流结束时 `end()` 把尾部未成句的残余 flush 出来。行内一旦出现明确的
 * 句末标点就先提交，避免长段落攒到最后一起出声（首句延迟退化成一个段落）。
 *
 * **位置**：跑在渲染层（mainview）。文本整理是渲染层的职责，主进程只做无状态的
 * 「一句话 → 音频」转发，因此原始 markdown 不出渲染层，过 IPC 的永远是净化好的句子。
 */

/** 单句长度上限：超过后在最近的逗号 / 空格处断句，避免无标点的超长行整段合成。 */
const MAX_SENTENCE_LEN = 120;

/** 直接视为句末的 CJK 标点。 */
const CJK_TERMINATORS = new Set(["。", "！", "？", "；", "…"]);

/**
 * 句子至少要有一个可朗读字符（字母 / 数字 / CJK），否则不发请求。
 *
 * 这是**唯一出口的硬约束**：`pushSentence` 是全部产出路径的收口，新增产出路径必须同样
 * 经过它——宁可整句丢内容，也不发一句会被 provider 拒收的文本。
 */
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;

/** 整行就是一个代码围栏标记（可带 info string）：```js / ~~~。 */
const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})[A-Za-z0-9+#._-]*\s*$/;

/** `remove-markdown` 漏掉的标记（未成对的强调符、表格竖线、方括号）与零宽字符。 */
const RESIDUE_RE = /[`*_~|\u005B\u005D]|\p{Cf}/gu;

export interface TtsTextSplitter {
  /** 喂入一段原始文本（任意长度），返回可立即合成的完整句子。 */
  feed(chunk: string): string[];
  /** 输入结束：flush 尾部未成句的残余（若有任何）。 */
  end(): string[];
}

/** 单行净化：markdown 标记 → 自然语言文本。 */
function sanitizeLine(line: string): string {
  return removeMd(line)
    .replace(/https?:\/\/\S+/g, " ") // 裸 URL 不读（markdown 的链接语义就是不读出 URL）
    .replace(/^\s*\[[ xX]\]\s*/, "") // 任务框 [x] / [ ]（remove-markdown 只去掉列表前缀）
    .replace(RESIDUE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createTtsTextSplitter(): TtsTextSplitter {
  /** 正在丢弃的代码围栏（``` / ~~~）。 */
  let inFence = false;
  /** 尚未凑成完整行的残余（feed 不按行对齐）。 */
  let lineBuf = "";
  /** 当前正在累积的句子。 */
  let sentence = "";
  /** 上一字符是「字母后的拉丁句点」，等下一个字符判断是否真是句末（避免 3.5 / v1.2 被切碎）。 */
  let pendingDot = false;
  const out: string[] = [];

  const pushSentence = (text: string): void => {
    const trimmed = text.trim();
    // 纯符号 / 空白碎片（水平线 `---`、落单标点、裸 emoji）没有可朗读内容：
    // 发出去会被 provider 拒收，直接丢弃。
    if (!trimmed || !SPEAKABLE_RE.test(trimmed)) return;
    out.push(trimmed);
  };

  const flushSentence = (): void => {
    const text = sentence;
    sentence = "";
    pushSentence(text);
  };

  /** 超长句在尾部 60 字符内找最近的逗号 / 分号 / 空格断句；找不到就硬切。 */
  const splitLongSentence = (): void => {
    const from = Math.max(0, sentence.length - 60);
    let cut = -1;
    for (let i = sentence.length - 1; i >= from; i--) {
      if (",，;； ".includes(sentence[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut > 0) {
      pushSentence(sentence.slice(0, cut));
      sentence = sentence.slice(cut);
    } else {
      pushSentence(sentence.slice(0, MAX_SENTENCE_LEN));
      sentence = sentence.slice(MAX_SENTENCE_LEN);
    }
  };

  const scanChar = (ch: string): void => {
    if (pendingDot) {
      pendingDot = false;
      // 下一个字符仍是字母 / 数字 → 属于文件路径或版本号（backend.ts / v1.2），不是句末
      if (!/[A-Za-z0-9]/.test(ch)) flushSentence();
    }
    if (CJK_TERMINATORS.has(ch) || ch === "!" || ch === "?") {
      sentence += ch;
      flushSentence();
      return;
    }
    if (ch === "." && /[A-Za-z]/.test(sentence.charAt(sentence.length - 1))) {
      sentence += ch;
      pendingDot = true;
      return;
    }
    sentence += ch;
    if (sentence.length > MAX_SENTENCE_LEN) splitLongSentence();
  };

  const processLine = (line: string): void => {
    // 整行只有围栏标记才算开关；正文里提到 ``` 不当围栏（那种会走下面的残留清理）
    if (FENCE_LINE_RE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const sanitized = sanitizeLine(line);
    // 整行没有可朗读内容（表格分隔行、水平线、落单标点）→ 整行丢弃
    if (!SPEAKABLE_RE.test(sanitized)) return;
    // 换行不断句，但与上一行文本之间补一个空格（中文 TTS 不会把空格读成停顿）
    if (sentence && !/\s$/.test(sentence)) sentence += " ";
    for (const ch of sanitized) scanChar(ch);
  };

  /**
   * 未成行残余里「可以确定是句末」的最后一个标点位置（没有则 -1）。
   *
   * 只认明确无歧义的：CJK 句末标点与 `!` `?`；拉丁句号必须**后面已有字符且是空白**
   * 才算句末（`done. Next` 算，`v1.` / `backend.ts` 不算——否则会在版本号/路径中间切断）。
   */
  const lastCommitableTerminator = (text: string): number => {
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i];
      if (CJK_TERMINATORS.has(ch) || ch === "!" || ch === "?") return i;
      if (ch === "." && i + 1 < text.length && /\s/.test(text[i + 1])) return i;
    }
    return -1;
  };

  /**
   * 把**未成行**的残余里已经确定的句子提前提交。
   *
   * 若只在整行到齐后才分句，长段落（换行只出现在段尾）会被攒成一批同时出声，首句延迟
   * 退化成一个段落；抢占（换会话 / 手动朗读）时那一整段还会被直接丢掉。因此行内一旦
   * 出现明确的句末标点就先提交到那里，剩下的继续等下一块文本。
   */
  const drainPartialLine = (): void => {
    const cut = lastCommitableTerminator(lineBuf);
    if (cut === -1) return;
    processLine(lineBuf.slice(0, cut + 1));
    lineBuf = lineBuf.slice(cut + 1);
  };

  return {
    feed(chunk: string): string[] {
      out.length = 0;
      lineBuf += chunk;
      let idx: number;
      while ((idx = lineBuf.indexOf("\n")) !== -1) {
        processLine(lineBuf.slice(0, idx));
        lineBuf = lineBuf.slice(idx + 1);
      }
      drainPartialLine();
      return out.slice();
    },

    end(): string[] {
      out.length = 0;
      // 未闭合的代码围栏：残余内容同样丢弃
      if (!inFence) processLine(lineBuf);
      lineBuf = "";
      // 尾部悬挂的拉丁句点按句末处理
      pendingDot = false;
      flushSentence();
      return out.slice();
    },
  };
}
