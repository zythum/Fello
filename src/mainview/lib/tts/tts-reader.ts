import { subscribe, request } from "../../backend";
import { generateUUID } from "@/lib/utils";
import { ttsPlayer } from "./tts-player";
import { createTtsTextSplitter, type TtsTextSplitter } from "./tts-text";

/**
 * TTS 朗读会话管理（渲染层唯一入口）。
 *
 * 分工：
 * - **渲染层（本文件）**：持有分句器，把 agent 的 markdown 原文整理成可朗读的句子，
 *   再按顺序串行地交给主进程；音频经 `tts-audio` 回到这里入播放队列（tts-player 出声）。
 * - **主进程**：无状态转发 —— 收到一句话就 `sendText` + `flush`，不碰文本、不攒队列。
 *
 * 一个「前台会话」= 一次朗读（自动朗读的某条回复 / 手动朗读的某条消息）：
 * - 同一时刻只有一个前台会话；新的开始会抢占（关掉旧的 + 停播放）
 * - 后端 TTS 会话（`startTts`）推迟到**第一句成形**时才创建：整段都是代码 / 标记时
 *   一句都分不出来，就没必要建连接
 * - 一次朗读的所有 IPC（start → speak×N → end）挂在同一条链上，保证顺序
 * - 自动朗读的启动失败（没启用 provider / 鉴权失败）进 30s 冷却，避免逐句刷 toast
 */

/** 自动朗读启动失败后的冷却时间。 */
const START_RETRY_COOLDOWN_MS = 30_000;

let audioSubscribed = false;
/** 错误上报（每个会话最多一次）；由 React 层注册 toast。 */
let errorListener: ((message: string) => void) | null = null;
/** 手动朗读（整条消息）的会话 key；其它 key 都是 agent session id（自动朗读）。 */
const MANUAL_KEY = "manual";

/**
 * 被手动停止的自动朗读会话：**本次回复（prompt）结束前不再朗读**。
 *
 * 否则「停止」只是掐掉当前已经排队的音频，下一句文本一到又会自己读起来 ——
 * 表现就是「点停止 → 提示消失 → 立刻又出现，怎么都停不掉」。
 * prompt-end（`endTtsStream`）时解除，下一条回复恢复自动朗读。
 */
const suppressedAutoKeys = new Set<string>();

const erroredSessions = new Set<string>();

/**
 * 唯一被允许出声的后端 TTS 会话 id（当前在册的那个）。
 *
 * 播放互斥的**唯一闸门**：音频分片只有 id 命中它才允许进播放队列。
 * 已经提交给 provider 的文本，其音频分片随后仍会陆续回调（停止时「还有一段在路上」是常态），
 * 而 `ttsPlayer.stop()` 只管得住**已经入队**的分片 —— 对迟到分片无能为力：它们会新建播放
 * 会话把声音重新拉起来，于是新旧两个朗读交替出声（新分片一到又抢占旧的，来回切）。
 *
 * 抢占 / 停止 / 出错时立即置空，新会话成形时写入自己的 id。每次朗读只发出一个 id，
 * 所以「只认最新 id」不会误伤自己；`tts-closed` 与在途分片的先后顺序不保证，因此不依赖
 * 关闭事件做清理。
 */
let liveTtsSessionId: string | null = null;

/** 最近一次自动朗读归属的 agent 会话（停止时用它抑制后续朗读）。 */
let lastAutoKey: string | null = null;
/** 上次自动朗读启动失败的时间戳。 */
let startFailedAt = 0;

interface ReaderSession {
  /** 归属：自动朗读用 agent sessionId，手动朗读用 `manual`。 */
  key: string;
  splitter: TtsTextSplitter;
  /** 后端 TTS 会话 id；首个句子成形时才赋值。 */
  ttsSessionId: string | null;
  /** IPC 调用链：start → speak×N → end 的顺序由它保证。 */
  chain: Promise<void>;
  /** 已进入收尾（不再接受 feed）。 */
  ended: boolean;
  /** 会话已废（启动失败 / 后端关闭）：后续步骤直接跳过。 */
  dead: boolean;
  /** 是否受启动失败冷却约束（自动朗读 true；手动朗读 false，用户点一次就该试一次）。 */
  respectCooldown: boolean;
}

/** 当前前台会话（同一时刻最多一个）。 */
let current: ReaderSession | null = null;

function ensureAudioSubscription(): void {
  if (audioSubscribed) return;
  audioSubscribed = true;

  subscribe.on("tts-audio", (detail) => {
    // 只接受在册会话的音频：停止 / 抢占后旧会话的在途分片一律丢弃（停之后不该再有声音）
    if (detail.ttsSessionId !== liveTtsSessionId) return;
    // v1 只播 PCM（主进程恒按 pcm 请求，这里是防御）
    if (detail.format !== "pcm") return;
    ttsPlayer.enqueueChunk({
      sessionId: detail.ttsSessionId,
      audioB64: detail.audioB64,
      sampleRate: detail.sampleRate ?? 16000,
    });
  });

  subscribe.on("tts-closed", (detail) => {
    const session = current;
    if (session?.ttsSessionId === detail.ttsSessionId) {
      session.ttsSessionId = null;
      session.dead = true;
    }
  });

  subscribe.on("tts-error", (detail) => {
    const session = current;
    if (!session || session.ttsSessionId !== detail.ttsSessionId) return;
    if (erroredSessions.has(detail.ttsSessionId)) return;
    erroredSessions.add(detail.ttsSessionId);
    const ttsSessionId = detail.ttsSessionId;
    session.dead = true;
    session.ttsSessionId = null;
    current = null;
    // 出错会话立即从「在册」中摘掉：其在途分片不能再出声
    if (liveTtsSessionId === ttsSessionId) liveTtsSessionId = null;
    // 运行时错误（鉴权 / 参数 / 断连）也要退避：否则后续每个句子都会重新开一次会话、
    // 再报一次错。手动朗读不受冷却约束（respectCooldown=false），用户点了就再试。
    startFailedAt = Date.now();
    ttsPlayer.stop();
    errorListener?.(detail.message);
    void request.endTts({ ttsSessionId }).catch(() => {
      // 会话可能已被服务端关闭，忽略
    });
  });
}

export function onTtsError(listener: ((message: string) => void) | null): void {
  errorListener = listener;
}

function newTtsSessionId(): string {
  return generateUUID().replace(/-/g, "").slice(0, 16);
}

/** 链上追加一步；单步失败不影响后续步骤（错误由 `tts-error` 事件上报）。 */
function appendStep(session: ReaderSession, step: () => Promise<void>): void {
  session.chain = session.chain.then(step).catch(() => {});
}

/** 懒启动后端会话；返回会话 id，未启动（冷却中 / 启动失败 / 已废）返回 null。 */
async function ensureBackendSession(session: ReaderSession): Promise<string | null> {
  if (session.ttsSessionId) return session.ttsSessionId;
  if (session.dead) return null;
  if (session.respectCooldown && Date.now() - startFailedAt < START_RETRY_COOLDOWN_MS) return null;

  const ttsSessionId = newTtsSessionId();
  try {
    await request.startTts({ ttsSessionId });
  } catch (error) {
    session.dead = true;
    erroredSessions.add(ttsSessionId);
    if (session.respectCooldown) startFailedAt = Date.now();
    errorListener?.(error instanceof Error ? error.message : String(error));
    return null;
  }
  session.ttsSessionId = ttsSessionId;
  // startTts 往返期间可能已被抢占（session 已废）：那就不能把「在册」抢回来，
  // 否则旧会话的音频又会被放出来。这里只登记 id，连接交给链尾的 `appendEnd` 关掉。
  if (session.dead) return null;
  // 新会话成形：它是此刻唯一被允许出声的会话
  liveTtsSessionId = ttsSessionId;
  return ttsSessionId;
}

/** 一句话入链：懒启动 → `speakTts`。 */
function appendSentence(session: ReaderSession, sentence: string): void {
  appendStep(session, async () => {
    if (session.dead) return;
    const ttsSessionId = await ensureBackendSession(session);
    if (!ttsSessionId) return;
    await request.speakTts({ ttsSessionId, text: sentence });
  });
}

/** 收尾：链尾关掉后端会话（一句都没产出过则从未建过连接，无需关闭）。 */
function appendEnd(session: ReaderSession): void {
  appendStep(session, async () => {
    const ttsSessionId = session.ttsSessionId;
    session.ttsSessionId = null;
    if (!ttsSessionId) return;
    try {
      await request.endTts({ ttsSessionId });
    } finally {
      erroredSessions.delete(ttsSessionId);
    }
  });
}

/**
 * 结束一次朗读。
 * `flushTail` = 是否补发尾部未成句的残余（自然说完 true；抢占 / 手动停止 false）。
 */
function endSession(session: ReaderSession, options: { flushTail?: boolean } = {}): void {
  if (session.ended) return;
  session.ended = true;
  if (!options.flushTail) {
    // 停止 / 抢占：链上还没发出去的句子统统丢掉，在途音频也丢弃 ——
    // 否则「停止」之后剩下的句子还会一句句冒出来，在途分片还会把声音重新拉起来。
    session.dead = true;
    liveTtsSessionId = null;
  }
  if (options.flushTail && !session.dead) {
    for (const sentence of session.splitter.end()) appendSentence(session, sentence);
  }
  // dead 只表示「不再发新句子」，已建立的连接仍要关掉
  appendEnd(session);
  if (current === session) current = null;
}

/** 开一个新的前台会话（抢占旧的），返回它。 */
function startSession(key: string, respectCooldown: boolean): ReaderSession {
  // 抢占先作废在册 id：此刻起旧会话的在途分片全部丢弃。
  // 必须先做，而不是只依赖 `endSession` —— 前台会话可能早已收尾（手动朗读喂完即收尾、
  // 音频还在排空），此时 current 为 null，只停播放拦不住回程路上的分片。
  liveTtsSessionId = null;
  if (current) endSession(current);
  ttsPlayer.stop();
  const session: ReaderSession = {
    key,
    splitter: createTtsTextSplitter(),
    ttsSessionId: null,
    chain: Promise.resolve(),
    ended: false,
    dead: false,
    respectCooldown,
  };
  current = session;
  return session;
}

function getOrCreateAutoSession(key: string): ReaderSession {
  if (current && current.key === key && !current.ended) return current;
  return startSession(key, true);
}

/**
 * 自动朗读：把 agent 的**原始 markdown 文本**追加进该会话的朗读流。
 * 同一个 key 复用当前前台会话；key 变了（切会话）则抢占。
 */
export function feedTtsStream(key: string, rawText: string): void {
  ensureAudioSubscription();
  lastAutoKey = key;
  // 本条回复已被手动停止：直到 prompt 结束都不再朗读
  if (suppressedAutoKeys.has(key)) return;
  const session = getOrCreateAutoSession(key);
  for (const sentence of session.splitter.feed(rawText)) appendSentence(session, sentence);
}

/** 自动朗读收尾（prompt 结束）：补发尾部残余并关闭后端会话。 */
export function endTtsStream(key: string): void {
  // 本次回复结束：解除「停止朗读」的抑制，下一条回复恢复自动朗读
  suppressedAutoKeys.delete(key);
  const session = current;
  if (!session || session.key !== key) return;
  endSession(session, { flushTail: true });
}

/**
 * 手动朗读整条消息（内部同样分句、串行合成；每次都重新开始一次朗读）。
 *
 * **互斥**：手动朗读会立刻接麦 ——
 * - 抢占当前正在读的内容（`startSession` 会终止前台会话并丢弃其音频）
 * - 并且接管本轮：抑制该轮后续的自动朗读（否则流式新句一到就会把这条打断了）
 *   下一条 prompt（`resetTtsForNewPrompt`）恢复自动朗读。
 */
export function speakOnce(rawText: string): void {
  ensureAudioSubscription();
  if (lastAutoKey) suppressedAutoKeys.add(lastAutoKey);
  const session = startSession(MANUAL_KEY, false);
  for (const sentence of session.splitter.feed(rawText)) appendSentence(session, sentence);
  endSession(session, { flushTail: true });
}

/**
 * 离开当前会话视图（切到别的会话 / 视图卸载）：停掉声音，并**清掉本轮的全部残留状态**。
 *
 * 与「停止朗读」的区别在于意图：
 * - 停止：用户对本轮的有意表态 → 抑制到本轮结束（`prompt-end` 才恢复）
 * - 切走：只是离开 → 不该把「抑制」留着，否则切回来这一轮就再也不读了
 *
 * 因此这里在停声之后额外清掉抑制记录与最近自动朗读的 key，回到该会话时
 * 后续流式文本可以正常继续朗读。
 */
export function leaveTtsSession(): void {
  stopActiveTts();
  if (lastAutoKey) suppressedAutoKeys.delete(lastAutoKey);
  lastAutoKey = null;
}

/**
 * 用户发起新的一轮（`prompt-start`）：停掉上一轮还在响的声音，并让新一轮恢复自动朗读。
 *
 * 发送新 prompt 是最强的「我要听别的」信号：没读完的旧回复立即静音，且不受此前
 * 「停止朗读」抑制的影响（新一轮从头读）。
 */
export function resetTtsForNewPrompt(key: string): void {
  // 先停（内部会把最近一轮的自动朗读 key 记入抑制）……
  stopActiveTts();
  // ……再放行本会话：新一轮该读就读
  suppressedAutoKeys.delete(key);
}

/**
 * 停止当前朗读：立刻停播放，丢弃在途音频，并（丢弃尾句地）关掉后台会话。
 *
 * 三件事各自独立，缺一个都会「停不干净」：
 * 1. **抑制本条回复**的后续自动朗读（按最近一次自动朗读的 key，而不是当前前台会话：
 *    点停止时前台可能已经是手动朗读、或者朗读会话早已收尾）
 * 2. **作废在册会话 id** 以丢弃在途音频 —— 已经提交给 provider 的文本，其音频往往
 *    还在回调路上；只处理 `current` / 只停播放的话，这种「回复已结束、音频还在排空」的
 *    时刻就拦不住，分片一到又会把播放重新拉起来（提示消失又冒出）
 * 3. 停播放 + 关掉前台朗读会话
 */
export function stopActiveTts(): void {
  if (lastAutoKey) suppressedAutoKeys.add(lastAutoKey);

  liveTtsSessionId = null;

  ttsPlayer.stop();
  if (current) endSession(current);
}
