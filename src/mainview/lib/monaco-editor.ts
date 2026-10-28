import * as monaco from "monaco-editor-core";
import EditorWorker from "monaco-editor-core/esm/vs/editor/editor.worker.start?worker";
import { shikiToMonaco, textmateThemeToMonacoTheme } from "@shikijs/monaco";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import { bundledThemes } from "shiki/themes";
import { SHIKI_GRAMMAR_LANGS, SHIKI_LANGS, SHIKI_THEMES } from "./shiki-preload";

/**
 * 配置 Monaco 的 worker 加载（Vite 专用）。
 *
 * Monaco 在用到 folding、链接检测等能力时会实例化 editorWorkerService，
 * 默认走 `new URL(..., import.meta.url)` 动态加载，与 Vite dev 不兼容，
 * 控制台报 "Failed to load worker script for label: editorWorkerService"。
 * 这里用 Vite 的 `?worker` 导入把 worker 打包为独立脚本统一返回；
 * 本项目高亮由 Shiki 提供，未注册任何语言服务 worker，全部复用基础 EditorWorker。
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, _label: string): Worker {
    return new EditorWorker();
  },
};

/**
 * 将 hex 颜色按比例混合（RGB 近似）。
 * @pierre/diffs 的行号色使用 color-mix(in lab, fg 65%, bg)，此处以 RGB 近似，
 * 视觉差异可忽略，但能保证跟随 Shiki 主题的 fg/bg 实时计算。
 */
function mixHex(hexA: string, ratioA: number, hexB: string, ratioB: number): string {
  const parse = (hex: string) => {
    const h = hex.replace(/^#/, "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(hexA);
  const [r2, g2, b2] = parse(hexB);
  const ch = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${ch(r1 * ratioA + r2 * ratioB)}${ch(g1 * ratioA + g2 * ratioB)}${ch(b1 * ratioA + b2 * ratioB)}`;
}

/**
 * Monaco 编辑器与 Shiki 的统一初始化。
 *
 * 背景：
 * - `monaco-editor-core` 不内置任何语言（连 plaintext 都没有），
 *   `@shikijs/monaco` 只对 monaco 已注册的语言设置 tokensProvider，
 *   因此必须先 `monaco.languages.register` 注册需要高亮的语言 id。
 * - worker 加载由上方 `self.MonacoEnvironment` 统一接管（Vite `?worker` 产物），
 *   基础 EditorWorker 供 folding / 链接检测等内置服务使用。
 * - `@shikijs/monaco` 需要真正的 Shiki highlighter 实例。`@pierre/diffs` 自 1.6
 *   起把 highlighter 换成了自有抽象（不再暴露底层 Shiki 实例），因此这里按与
 *   `shiki-preload` 相同的主题/语言集合独立创建一个，引擎沿用 `shiki-js` 后端
 *   所用的 JavaScript RegExp（不额外加载 oniguruma wasm）。
 */

// Monaco 语言 id 通常只允许字母/数字/下划线；带连字符的 id（如 git-commit）跳过，
// 这类特殊语言在文件编辑场景用不到。
const REGISTERABLE_LANG_RE = /^[a-zA-Z0-9_]+$/;

let initPromise: Promise<void> | null = null;

/**
 * 初始化 Monaco（注册语言 + 绑定 Shiki tokensProvider + 注册主题）。
 * 幂等：多次调用只执行一次。
 */
export function initMonacoEditor(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const highlighter = await createHighlighterCore({
        themes: SHIKI_THEMES.map((name) => bundledThemes[name]),
        langs: SHIKI_GRAMMAR_LANGS.map((lang) => bundledLanguages[lang]),
        engine: createJavaScriptRegexEngine(),
      });

      for (const lang of SHIKI_LANGS) {
        if (!REGISTERABLE_LANG_RE.test(lang)) continue;
        const exists = monaco.languages.getLanguages().some((l) => l.id === lang);
        if (!exists) {
          monaco.languages.register({ id: lang });
        }
      }

      shikiToMonaco(highlighter, monaco);

      // 对齐 @pierre/diffs 的行号样式：--diffs-fg-number = fg 65% + bg 35% 混合。
      // shikiToMonaco 注册的主题未包含 editorLineNumber 颜色，走 Monaco 默认色（偏蓝），
      // 这里基于 Shiki 主题的 fg/bg 计算并覆盖，亮/暗主题各一份。
      for (const themeName of SHIKI_THEMES) {
        const theme = highlighter.getTheme(themeName);
        if (!theme?.fg || !theme?.bg) continue;
        const lineNumberColor = mixHex(theme.fg, 0.65, theme.bg, 0.35);
        const themeData = textmateThemeToMonacoTheme(theme);
        themeData.colors = {
          ...themeData.colors,
          "editorLineNumber.foreground": lineNumberColor,
          "editorLineNumber.activeForeground": lineNumberColor,
        };
        monaco.editor.defineTheme(themeName, themeData);
      }
    })();
  }
  return initPromise;
}

export { monaco };

/** 从文件名推断 Shiki/编辑器语言 id（复用 @pierre/diffs 的语言推断） */
export { getFiletypeFromFileName } from "@pierre/diffs";
