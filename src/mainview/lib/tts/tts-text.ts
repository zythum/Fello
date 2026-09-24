/**
 * 流式文本 → TTS 分句。
 *
 * Agent 输出是带 markdown 的：代码块、链接、强调、列表、表格。直接喂给合成不只是
 * 读出符号，还会被服务端拒收 —— DashScope 对「没有任何可朗读字符」的输入返回
 * `InvalidParameter: Please ensure input text is valid.`
 * （实测：`：` / `.` / `—` / 单空格 均被拒；`--- ---` 这种纯符号串同样无法朗读）。
 * 因此这里做四件事：
 * 1. 代码围栏（``` / ~~~）整段丢弃——读代码是体验灾难
 * 2. 剥掉 markdown 符号（表格竖线与分隔行、任务列表方框、强调、链接语法……）与 emoji
 * 3. 只产出「含字母 / 数字 / CJK」的句子，纯符号碎片直接丢弃（既不朗读也不发请求）
 * 4. 按句末标点切分，增量地产出「完整句子」，主进程按句合成以压低首句出声延迟
 *
 * 有状态的增量切分器：调用方按到达顺序 `feed()` 任意长度的原始文本块，每次拿到
 * 可立即合成的完整句子；流结束时 `end()` 把尾部未成句的残余 flush 出来。
 *
 * 分句是启发式的（正则 + 字符状态机），目标是覆盖 95% 的 agent 输出，
 * 不追求完整 markdown 解析；边界情况宁可切成两句也不喂出乱码。
 *
 * **位置**：跑在渲染层（mainview）。文本整理（本文件 + `tts-reader.ts`）是渲染层的职责，
 * 主进程只做无状态的「一句话 → 音频」转发，因此原始 markdown 不出渲染层，
 * 过 IPC 的永远是已经净化好的句子。
 */

/** 单句长度上限：超过后在最近的逗号 / 空格处断句，避免无标点的超长行整段合成。 */
const MAX_SENTENCE_LEN = 120;

/** 直接视为句末的 CJK 标点。 */
const CJK_TERMINATORS = new Set(["。", "！", "？", "；", "…"]);

/** 句子至少要有一个可朗读字符（字母 / 数字 / CJK 等），否则不发请求。 */
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;

/**
 * 读出来只是噪音的字符：
 * - `So`/`Sk`/`Sm`：emoji、装饰符号、箭头与数学符号（✅ → | ~ = + < > ^ `）
 * - `Cf`/`Co`/`Cs`/`Cn`：零宽字符、格式控制符、私用区与未分配码位
 * - 显式补上 markdown 残留的 ASCII 装饰符（`*` `_` `#` 及括号与反斜杠）
 * 中英文标点、货币符号、破折号（读作停顿）都保留。
 */
const DECORATION_RE = /[\p{So}\p{Sk}\p{Sm}\p{Cf}\p{Co}\p{Cs}\p{Cn}*_#\u005B\u005D\u007B\u007D\\]/gu;

export interface TtsTextSplitter {
  /** 喂入一段原始文本（任意长度），返回可立即合成的完整句子。 */
  feed(chunk: string): string[];
  /** 输入结束：flush 尾部未成句的残余（若有任何）。 */
  end(): string[];
}

/** 代码围栏行：行首（最多 3 个缩进空格）出现 3 个以上反引号或波浪号。 */
function isFenceMarker(line: string): boolean {
  return /^\s{0,3}(`{3,}|~{3,})/.test(line);
}

/**
 * 未成行残余里「可以确定是句末」的最后一个标点位置（没有则 -1）。
 *
 * 只认明确无歧义的：CJK 句末标点与 `!` `?`；拉丁句号必须**后面已有字符且是空白**
 * 才算句末（`done. Next` 算，`v1.` / `backend.ts` 不算——否则会在版本号/路径中间切断）。
 */
function lastCommitableTerminator(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (CJK_TERMINATORS.has(ch) || ch === "!" || ch === "?") return i;
    if (ch === "." && i + 1 < text.length && /\s/.test(text[i + 1])) return i;
  }
  return -1;
}

/** 单行 markdown 净化：去掉符号，保留可读文本。 */
function sanitizeLine(line: string): string {
  let s = line;
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // 图片 ![alt](url) → 丢弃
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // [text](url) → text
  s = s.replace(/https?:\/\/\S+/g, " "); // 裸 URL → 丢弃
  s = s.replace(/^\s{0,3}#{1,6}\s+/, ""); // 标题行
  s = s.replace(/^\s{0,3}>\s?/, ""); // 引用行
  s = s.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/, ""); // 列表项前缀
  s = s.replace(/^\s*\[[ xX]\]\s*/, ""); // 任务列表复选框 [ ] / [x]
  s = s.replace(/`([^`]*)`/g, "$1"); // 行内 code：去掉反引号保留内容
  s = s.replace(DECORATION_RE, " "); // emoji / 装饰符号 / markdown 残留符号
  s = s.replace(/\s+/g, " ").trim();
  // 行首行尾残留的分隔线符号（--- / ——）：不是内容，读出来只是噪音
  return s.replace(/^[-–—]+|[-–—]+$/g, "").trim();
}

export function createTtsTextSplitter(): TtsTextSplitter {
  let inFence = false;
  /** 尚未凑成完整行的残余（feed 不按行对齐）。 */
  let lineBuf = "";
  /** 当前正在累积的句子。 */
  let sentence = "";
  /** 上一字符是「字母后的拉丁句点」，等待下一个字符判断是否真是句末（避免 3.5 / v1.2 被切碎）。 */
  let pendingDot = false;
  const out: string[] = [];

  const pushSentence = (text: string): void => {
    const trimmed = text.trim();
    // 纯符号 / 空白碎片（表格分隔行 `--- ---`、落单标点、裸 emoji）没有可朗读内容：
    // 发出去会被服务端拒收（InvalidParameter），直接丢弃。
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
    if (CJK_TERMINATORS.has(ch)) {
      sentence += ch;
      flushSentence();
      return;
    }
    if (ch === "!" || ch === "?") {
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
    if (inFence) {
      if (isFenceMarker(line)) inFence = false;
      return;
    }
    if (isFenceMarker(line)) {
      inFence = true;
      return;
    }
    // 行内出现的围栏标记（如「注意：\`\`\`js」）：先处理标记前的文本，再进入围栏。
    // CommonMark 的闭合围栏只允许出现在行首，所以 inFence 分支的关闭检测不受影响。
    //
    // 但**不能见标记就进围栏**：正文里提到 \`\`\` 很常见（「用 \`\`\` 包裹」），那样会把
    // 后面整条消息都吞掉。只有标记之后已无正文（最多一个 info string）才当作围栏开启；
    // 标记夹在正文中间时按假围栏处理——剥掉标记继续朗读。
    const inlineFence = line.search(/`{3,}|~{3,}/);
    const suffix = inlineFence === -1 ? "" : line.slice(inlineFence);
    const opensFence =
      inlineFence !== -1 && /^(?:`{3,}|~{3,})[A-Za-z0-9+#._-]*\s*$/.test(suffix);
    // 假围栏：连标记和紧跟其后的语言标识一起剥掉（否则会把 `js` / `python` 读出来）
    const prose =
      inlineFence === -1
        ? line
        : opensFence
          ? line.slice(0, inlineFence)
          : line.slice(0, inlineFence) + suffix.replace(/^(?:`{3,}|~{3,})[A-Za-z0-9+#._-]*/, " ");
    const sanitized = sanitizeLine(prose);
    // 整行都没有可朗读字符（表格分隔行 `| --- | --- |`、水平线 `---`、落单标点、裸 emoji）
    // → 整行丢弃，否则这些碎片会粘进后续句子被一起读出来。
    if (sanitized && SPEAKABLE_RE.test(sanitized)) {
      // 换行不断句，但与上一行文本之间补一个空格（中文 TTS 不会把空格读成停顿）
      if (sentence && !/\s$/.test(sentence)) sentence += " ";
      for (const ch of sanitized) scanChar(ch);
    }
    if (opensFence) inFence = true;
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
