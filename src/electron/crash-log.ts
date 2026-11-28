/**
 * 崩溃留痕与启动失败弹窗。
 *
 * 背景：`initBackend()` 在 `app.ts` 的模块顶层执行（`app.whenReady()` 之前），任何启动期异常
 * 都会让主进程在创建窗口之前退出。从桌面图标（.desktop / 快捷方式）启动时 stderr 无处可去，
 * 用户看到的只有「没启动起来」，我们也拿不到堆栈。这里把崩溃写进 `~/.fello-crash.log`，
 * 并在启动阶段用原生错误框把原因和日志路径告诉用户。
 *
 * 约定：
 * - `crash.log` 只保留**最后一次错误**：每次写入都覆盖，不做跨运行/跨错误的累积；
 * - 启动时不清空文件：上一次留下的错误记录会一直保留到下一次真的出错为止
 *   （启动期崩溃 → 用户重开一次仍失败 → 记录被本次的新错误覆盖；重开成功则旧记录仍在）；
 * - 写日志本身永不抛错，绝不掩盖原始异常；
 * - `uncaughtException` 一律视为致命：记日志 → 弹窗 → 退出；
 * - 启动完成后的 `unhandledRejection` 只记日志，不弹窗也不退出（会话进行中不能被打断）；
 * - 同一进程只弹一次窗，避免兜底链路自身重复报错刷屏。
 *
 * 依赖约束：本模块会被**薄入口** `main.ts` 静态 import，所以只允许依赖 node 内置模块与
 * `electron`——一旦引入 i18n / storage 之类，薄入口就被这些模块的加载期风险重新污染，等于白拆。
 */
import { writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { app, dialog } from "electron";

/**
 * 固定写进用户主目录，与数据根**解耦**：配置本身坏掉时（移动盘没插、
 * .fellorc 写错、~/.fello 不存在）恰恰是最需要日志的时候。
 */
export const CRASH_LOG_PATH = join(homedir(), ".fello-crash.log");

/**
 * 弹窗文案。
 *
 * 默认英文：入口加载期崩溃时 i18n 还没就绪（它在 app.ts 那一侧），这正是必须无依赖兜底的场景。
 * `app.ts` 加载完成后会通过 setCrashDialogText 换成跟随界面语言的实现。
 */
export interface CrashDialogText {
  title: () => string;
  message: (entry: string, path: string) => string;
}

let dialogText: CrashDialogText = {
  title: () => "Fello failed to start",
  message: (entry, path) => `${entry}\n\nCrash details were written to:\n${path}`,
};

/** 由 app.ts 注入 i18n 版本（title/message 每次调用取当前语言）。 */
export function setCrashDialogText(text: CrashDialogText): void {
  dialogText = text;
}

/** 启动是否已经完成（窗口已创建）。完成后 unhandledRejection 不再算致命。 */
let startupFinished = false;
/** 已经弹过窗：兜底链路自己出错时不要反复打断用户。 */
let fatalReported = false;

/** 标记启动完成。在 `app.whenReady()` 主体末尾调用。 */
export function markStartupFinished(): void {
  startupFinished = true;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function environmentLine(): string {
  let version = "unknown";
  try {
    version = app.getVersion();
  } catch {
    // app 尚未就绪时取不到版本号，退化成 unknown
  }
  return [
    `Fello ${version}`,
    `electron ${process.versions.electron ?? "?"}`,
    `node ${process.versions.node ?? "?"}`,
    `${process.platform}-${process.arch}`,
  ].join(" · ");
}

/**
 * 写入一条崩溃记录（**覆盖**上一次的内容，文件里永远只有最后一次错误），
 * 返回写入的正文（写盘失败也返回，弹窗仍要能展示）。本函数永不抛错。
 */
export function writeCrashLog(scope: string, error: unknown): string {
  const entry = [
    `=== ${new Date().toISOString()} ===`,
    environmentLine(),
    `[${scope}]`,
    describeError(error),
    "",
    "",
  ].join("\n");

  try {
    writeFileSync(CRASH_LOG_PATH, entry, "utf8");
  } catch (logError) {
    console.error("[crash] Failed to write crash log:", logError);
  }

  console.error(`[crash] ${scope}:`, error);
  return entry;
}

/**
 * 致命失败：记日志 → 原生弹窗 → 退出进程。
 *
 * 弹窗是同步阻塞的，且 `dialog.showErrorBox` 允许在 `ready` 之前调用，所以启动早期也能用。
 * 调用后进程会退出，不要依赖本函数之后的代码继续执行。
 */
export function reportFatal(scope: string, error: unknown): void {
  const entry = writeCrashLog(scope, error);

  if (!fatalReported) {
    fatalReported = true;
    try {
      dialog.showErrorBox(dialogText.title(), dialogText.message(entry, CRASH_LOG_PATH));
    } catch (dialogError) {
      console.error("[crash] Failed to show error box:", dialogError);
    }
  }

  app.exit(1);
}

/** 注册进程级兜底。必须在 `main.ts` 里所有可能失败的启动代码之前调用。 */
export function installCrashHandlers(): void {
  process.on("uncaughtException", (error) => {
    reportFatal("uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    // 启动阶段没有任何窗口可提示用户，只能靠弹窗；启动之后只留痕。
    if (!startupFinished) {
      reportFatal("unhandledRejection", reason);
      return;
    }
    writeCrashLog("unhandledRejection", reason);
  });
}
