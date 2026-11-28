/**
 * 代理环境变量的唯一定义处。
 *
 * 写入侧在 `backend/proxy.ts` 的 `applyProxy()`：启动时把生效的代理写进 `process.env`，
 * 未启用 / 无效时删除这些键。读取侧是子进程：`StdioClientTransport` 只继承白名单 env
 * （HOME / PATH / SHELL 等），HTTP_PROXY 这类不会自动继承，必须显式传下去。
 */
export const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

/**
 * 取出应用当前的代理环境变量。
 *
 * 直接读 `process.env` 而不是依赖代理模块：`applyProxy()` 已经把结果同步到进程环境，
 * 普通子进程继承到的就是这个值，所以这里读到的与实际生效的代理一致；代理设置变更需要
 * 重启应用，进程存活期间不会出现「配置已改、环境未换」的窗口。
 */
export function readProxyEnv(source: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PROXY_ENV_KEYS) {
    const value = source[key];
    if (value) env[key] = value;
  }
  return env;
}
