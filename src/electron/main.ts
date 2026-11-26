/**
 * 主进程入口（薄壳）。
 *
 * 这里只放三类东西：
 * 1. 崩溃兜底（必须先于任何可能失败的加载）；
 * 2. 必须在 app ready 之前同步生效的注册：自定义 scheme、命令行开关；
 * 3. 动态 import 业务主体 `./app`。
 *
 * 为什么不用静态 import：`app.ts` 的依赖树（backend、存储、watcher、native 模块）里任何一处
 * 在**加载期**抛错，静态 import 都会让主进程直接死在入口 —— 从桌面图标启动时既没有窗口，也没有
 * 任何输出。改成动态导入后，这类失败变成可捕获的 rejection，能写进 `~/.fello/crash.log`
 * 并弹出原生错误框。
 *
 * 兼容性：只使用 `import()` + `.then/.catch`，不使用 top-level await。这样同一份源码在
 * electron-vite 产出 `es` 或 `cjs` 时都成立（cjs 下 `import()` 会被改写成
 * `Promise.resolve().then(() => require(...))`，抛错同样落在 then 回调里）。
 */
import "./env";
import { app, protocol } from "electron";
import { installCrashHandlers, reportFatal } from "./crash-log";

installCrashHandlers();

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
if (isDev) {
  app.commandLine.appendSwitch("no-sandbox");
}

// 注册自定义协议为特权 scheme，必须发生在 app ready 之前。
// 这段必须留在入口里同步执行：放进异步分块会与 ready 事件竞速，晚了就注册不上。
// URL 格式: fello://web/<resourceType>/<path>
protocol.registerSchemesAsPrivileged([
  {
    scheme: "fello",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

void import("./app").catch((error: unknown) => {
  reportFatal("load-app", error);
});
