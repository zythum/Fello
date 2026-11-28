/**
 * 启动门禁：在加载业务主体（`./app`）之前确认数据根可用。
 *
 * 数据根由 `FELLO_DATA_ROOT` / `~/.fellorc` / 默认 `~/.fello` 决定，由
 * `storage/constant.ts` 在**模块加载期**解析。配置坏掉时（移动盘没插、路径写错、
 * `.fellorc` 语法错误）不能直接崩在入口，也不能静默建一个空目录，必须让用户选：
 * 修好重试、本次用默认目录、还是把配置文件重命名掉（保留为 .bak，可恢复）。
 *
 * 只能在 app ready 之后、`import("./app")` 之前动态调用。
 */
import { existsSync, readFileSync, renameSync } from "fs";
import { dirname, join } from "path";
import { dialog, shell } from "electron";

import {
  DEFAULT_DATA_ROOT,
  FELLO_RC_PATH,
  getDataRootInfo,
  overrideDataRootForProcess,
  type DataRootInfo,
} from "../backend/config/config";

type Language = "en" | "zh-CN";

type Action = "retry" | "use-default" | "reveal" | "rename-rc" | "quit";

interface GateText {
  title: string;
  message: string;
  retry: string;
  useDefault: string;
  reveal: string;
  renameRc: string;
  quit: string;
  sourceEnv: string;
  sourceRc: string;
  hint: string;
  renameFailed: string;
}

const TEXT: Record<Language, GateText> = {
  en: {
    title: "Fello could not start",
    message: "The configured data root is not usable.",
    retry: "Retry",
    useDefault: "Use default directory",
    reveal: "Show config file",
    renameRc: "Rename config file and continue",
    quit: "Quit",
    sourceEnv: "Source: FELLO_DATA_ROOT environment variable",
    sourceRc: "Source: config file",
    hint: 'Fix the path (or mount the disk) and choose "Retry" to continue without launching again.',
    renameFailed: "Could not rename the config file:",
  },
  "zh-CN": {
    title: "Fello 无法启动",
    message: "配置的数据根不可用。",
    retry: "重试",
    useDefault: "使用默认目录",
    reveal: "显示配置文件",
    renameRc: "重命名配置文件后继续",
    quit: "退出",
    sourceEnv: "来源：环境变量 FELLO_DATA_ROOT",
    sourceRc: "来源：配置文件",
    hint: "修复路径（或插上磁盘）后点「重试」即可继续，不需要重新启动。",
    renameFailed: "无法重命名配置文件：",
  },
};

/**
 * 启动门禁跑在 backend 加载之前，用不了 i18n。退而求其次读默认数据根里的
 * settings.json；读不到就按应用默认语言（英文）显示。
 */
function detectLanguage(): Language {
  try {
    const raw = JSON.parse(readFileSync(join(DEFAULT_DATA_ROOT, "settings.json"), "utf-8")) as {
      i18n?: { language?: unknown };
    };
    return raw.i18n?.language === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

function buildDetail(info: DataRootInfo, text: GateText): string {
  const source = info.source === "env" ? text.sourceEnv : `${text.sourceRc} (${FELLO_RC_PATH})`;
  return [info.problem ?? "", "", source, "", text.hint].join("\n");
}

async function ask(info: DataRootInfo, language: Language): Promise<Action> {
  const text = TEXT[language];
  const actions: Action[] = ["retry", "use-default"];
  const buttons: string[] = [text.retry, text.useDefault];

  if (info.source === "rc") {
    buttons.push(text.reveal);
    actions.push("reveal");
    if (existsSync(FELLO_RC_PATH)) {
      buttons.push(text.renameRc);
      actions.push("rename-rc");
    }
  }

  buttons.push(text.quit);
  actions.push("quit");

  const { response } = await dialog.showMessageBox({
    type: "error",
    title: text.title,
    message: text.message,
    detail: buildDetail(info, text),
    buttons,
    defaultId: 0,
    // Esc / 关闭窗口等同于退出。
    cancelId: buttons.length - 1,
    noLink: true,
  });

  return actions[response] ?? "quit";
}

function revealConfigFile(): void {
  if (existsSync(FELLO_RC_PATH)) {
    shell.showItemInFolder(FELLO_RC_PATH);
    return;
  }
  void shell.openPath(dirname(FELLO_RC_PATH));
}

/** 返回 true 表示可以继续启动；false 表示用户选择退出。 */
export async function ensureUsableDataRoot(): Promise<boolean> {
  const language = detectLanguage();

  for (;;) {
    const info = getDataRootInfo();
    if (!info.problem) return true;

    const action = await ask(info, language);
    if (action === "quit") return false;

    if (action === "use-default") {
      // 只影响本次进程；不改环境变量，避免泄漏给子进程。
      overrideDataRootForProcess(DEFAULT_DATA_ROOT);
      continue;
    }

    if (action === "rename-rc") {
      // 重命名而不是删除：配置文件里有用户手写的内容，必须可恢复。
      const backup = `${FELLO_RC_PATH}.bak-${Date.now()}`;
      try {
        renameSync(FELLO_RC_PATH, backup);
      } catch (error) {
        dialog.showErrorBox(
          TEXT[language].title,
          `${TEXT[language].renameFailed}\n${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }

    if (action === "reveal") {
      revealConfigFile();
      continue;
    }

    // retry：回到循环重新解析，用户可以趁弹窗期间修好路径 / 插上磁盘。
  }
}
