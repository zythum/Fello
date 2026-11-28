import type { AddressInfo } from "net";
import { createServer, type Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { randomBytes, createHash } from "crypto";
import { networkInterfaces } from "os";
import { basename, join } from "path";
import { createReadStream, type Stats } from "fs";
import { readFile, stat } from "fs/promises";
import { parseFileRoute, serveRoute } from "./file-routes";
import type { FelloIPCSchema } from "../shared/schema";
import { extractErrorMessage } from "./utils";
import * as mimeTypes from "mime-types";
import type { BackendHandlers } from "./types";

// ── Static asset caching ─────────────────────────────────────────────

/**
 * 只有「文件名里带内容哈希」的构建产物才允许长缓存：内容一变文件名就变，
 * 旧 URL 永远不会再返回新内容，所以不会出现「发版后浏览器还在跑旧代码」。
 * 固定名字的文件（index.html 等）必须每次协商。
 * 判据故意写得保守：匹配不上就按不可长缓存处理（只是多一次协商，不会出错）。
 */
const CONTENT_HASHED_NAME_RE = /[-.][A-Za-z0-9_-]{6,}\.[a-z0-9]{2,5}$/;

/**
 * 非内容哈希命名的文件用「内容 MD5」做 ETag。打包进 app.asar 后，asar 内所有文件的
 * mtime 都是同一个值（实测等于 app.asar 的 mtime），而 index.html 每次发版的字节数
 * 几乎不变，size+mtime 很容易撞车 —— 一旦撞车浏览器就永远拿到旧 index.html。
 * 超过这个大小退回 size+mtime，避免每次协商都整份读文件。
 */
const CONTENT_ETAG_MAX_BYTES = 2 * 1024 * 1024;

/** 内容哈希命名 → 浏览器端永久缓存；private 避免被代理/隧道边缘等共享缓存留存。 */
const IMMUTABLE_CACHE_CONTROL = "private, max-age=31536000, immutable";
/** 固定名字的文件 → 每次都要协商（可用 304 省流量，但不能省掉校验）。 */
const REVALIDATE_CACHE_CONTROL = "no-cache";

// ── Types ────────────────────────────────────────────────────────────

export interface WebUIModule {
  broadcastEvent: <K extends keyof FelloIPCSchema["events"]>(
    channel: K,
    payload: FelloIPCSchema["events"][K],
  ) => boolean;
  start: (options?: { port?: number; token?: string }) => Promise<{ url: string }>;
  stop: () => void;
  getStatus: () => { enabled: boolean; url: string | null };
  /** 供 tunnel 模块读取监听端口与访问 token（不经过 IPC 暴露）。 */
  getAccessInfo: () => { enabled: boolean; port: number | null; token: string | null };
  setHandlers: (handlers: BackendHandlers) => void;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createWebUIModule(): WebUIModule {
  let backendHandlers: BackendHandlers | null = null;

  let httpServer: Server | null = null;
  let wss: WebSocketServer | null = null;
  let currentToken: string | null = null;
  let isEnabled = false;

  const connectedClients = new Set<WebSocket>();
  const clientIdsBySocket = new WeakMap<WebSocket, string>();

  const COOKIE_NAME = "fello_token";

  /** Extract token from Cookie header. */
  function getTokenFromCookie(req: {
    headers: Record<string, string | string[] | undefined>;
  }): string | null {
    const cookieHeader = req.headers["cookie"];
    if (!cookieHeader) return null;
    const cookies = (Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader).split(
      ";",
    );
    for (const cookie of cookies) {
      const [name, ...rest] = cookie.trim().split("=");
      if (name === COOKIE_NAME) {
        return rest.join("=") || null;
      }
    }
    return null;
  }

  /** Check whether the request carries a valid token (via cookie or query param). */
  function isAuthenticated(
    req: { headers: Record<string, string | string[] | undefined> },
    url: URL,
  ): boolean {
    const fromCookie = getTokenFromCookie(req);
    if (fromCookie && fromCookie === currentToken) return true;
    const fromQuery = url.searchParams.get("token");
    if (fromQuery && fromQuery === currentToken) return true;

    // ── Dev mode: Vite serves the page, use refer for Auth ──
    if (process.env.ELECTRON_RENDERER_URL) {
      const referer = String(req.headers.referer);
      if (referer.startsWith(process.env.ELECTRON_RENDERER_URL)) {
        return true;
      }
    }
    return false;
  }

  function getLocalIP() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
    return "localhost";
  }

  function broadcastEvent<K extends keyof FelloIPCSchema["events"]>(
    channel: K,
    payload: FelloIPCSchema["events"][K],
  ): boolean {
    if (!isEnabled || !wss) return false;
    // Fast check: does any authenticated WS client exist?
    let hasClients = false;
    for (const client of connectedClients) {
      if (client.readyState === 1 /* OPEN */) {
        hasClients = true;
        break;
      }
    }
    if (!hasClients) return false;

    const message = JSON.stringify({ type: "event", channel, payload });
    for (const client of connectedClients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(message);
      }
    }
    return true;
  }

  async function start(options?: { port?: number; token?: string }): Promise<{ url: string }> {
    if (isEnabled && httpServer) {
      return { url: getWebUIUrl(httpServer.address()) };
    }

    stop();

    currentToken =
      options?.token && options.token.trim() !== ""
        ? options.token.trim()
        : randomBytes(16).toString("hex");

    httpServer = createServer(async (req, res) => {
      // CORS for dev environment
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "GET" && req.url === "/favicon.ico") {
        res.writeHead(404);
        res.end("No Favicon");
        return;
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // ── Helper: write a 401 response ──────────────────────────────
      const unauthorized = () => {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
      };

      // ── Authenticate all requests ─────────────────────────────────
      // Page requests (SPA routes served via index.html) must carry a valid
      // `?token=` in the URL — if valid, a session cookie is set so subsequent
      // asset requests (JS, CSS, project files, WebSocket) can authenticate via cookie.
      //
      // All non-page requests authenticate via cookie (or ?token= as fallback).
      const isPageRequest = url.pathname === "/";

      const tokenFromQuery = url.searchParams.get("token");

      if (isPageRequest) {
        // Page request: must have a valid ?token= in the URL (cookie is NOT accepted)
        if (!tokenFromQuery || tokenFromQuery !== currentToken) {
          unauthorized();
          return;
        }
        // Valid token → set session cookie for subsequent requests
        res.setHeader(
          "Set-Cookie",
          `${COOKIE_NAME}=${tokenFromQuery}; Path=/; HttpOnly; SameSite=Lax`,
        );
      } else if (!isAuthenticated(req, url)) {
        // Non-page request (assets, project files): authenticate via cookie or ?token=
        unauthorized();
        return;
      }

      // ── 统一文件服务路由 ──
      // 由 file-routes.ts 统一解析，支持:
      //   /project/<projectId>/<relativePath>
      //   /share/<projectId>/<sessionId>/<sharePath>
      {
        const route = parseFileRoute(url);
        if (route) {
          const result = await serveRoute(route, { range: req.headers.range });
          res.writeHead(result.status, {
            "Content-Type": result.mimeType,
            ...result.headers,
          });
          if (result.stream) {
            // 分片流式回传：音视频拖动进度条时只读请求的那一段，不整份进内存。
            // 流中途出错（客户端提前断开等）直接销毁响应，避免挂着一个半截连接。
            result.stream.on("error", () => res.destroy());
            result.stream.pipe(res);
          } else {
            res.end(result.body ?? "");
          }
          return;
        }
      }

      // In prod, serve the static files from the renderer directory
      try {
        const isFile = url.pathname !== "/" && !url.pathname.endsWith("/");
        let reqPath = url.pathname;
        if (!isFile) {
          reqPath = "/index.html";
        }

        const baseDir = process.rendererPath;
        const indexHtmlPath = join(baseDir, "index.html");
        // /assets/* 只放构建产物，命中就是真的文件；没命中说明是旧版本留下的引用，
        // 必须 404 —— 绝不能回退成 index.html，否则这段 HTML 会被当成这个 JS/CSS
        // 缓存下来（长缓存），前端从此一直加载到一份 HTML。
        const isAssetPath = url.pathname.startsWith("/assets/");

        let filePath = join(baseDir, reqPath);

        let fileStat: Stats | null = await stat(filePath).catch(() => null);
        if (!fileStat || fileStat.isDirectory()) {
          if (isAssetPath) {
            res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
            res.end("Not found");
            return;
          }
          // SPA 路由 / 目录请求回退到 index.html
          filePath = indexHtmlPath;
          fileStat = await stat(filePath).catch(() => null);
        }
        if (!fileStat) throw new Error(`renderer asset not found: ${reqPath}`);

        const mime = mimeTypes.lookup(filePath) || "application/octet-stream";

        // ── Negotiate content encoding (brotli > gzip > identity) ──
        const acceptEncoding = (req.headers["accept-encoding"] as string) || "";
        let encoding: string | null = null;
        let encodedPath: string | null = null;
        let encodedStat: Stats | null = null;

        if (/\bbr\b/.test(acceptEncoding)) {
          const brPath = filePath + ".br";
          const brStat = await stat(brPath).catch(() => null);
          if (brStat?.isFile()) {
            encoding = "br";
            encodedPath = brPath;
            encodedStat = brStat;
          }
        }

        if (!encodedPath && /\bgzip\b/.test(acceptEncoding)) {
          const gzPath = filePath + ".gz";
          const gzStat = await stat(gzPath).catch(() => null);
          if (gzStat?.isFile()) {
            encoding = "gzip";
            encodedPath = gzPath;
            encodedStat = gzStat;
          }
        }

        // ── ETag / Cache-Control ──
        // 内容哈希命名的产物：文件名已经唯一标识内容，走 stat 生成的 ETag 即可，
        // 不必把上 MB 的文件读进内存（以前每个请求都算一次 MD5，且无法流式回传）。
        // 其余文件（index.html、SPA 回退）按内容算 ETag，保证内容一变就一定不会被 304
        // 掉——这是「发版后能及时更新」的关键，size+mtime 在 asar 里并不可靠。
        const actualPath = encodedPath ?? filePath;
        const servedStat = encodedStat ?? fileStat;
        const contentHashed =
          isAssetPath && CONTENT_HASHED_NAME_RE.test(basename(filePath));

        let etag: string;
        if (contentHashed || servedStat.size > CONTENT_ETAG_MAX_BYTES) {
          etag = `"${servedStat.size.toString(16)}-${Math.floor(servedStat.mtimeMs).toString(16)}"`;
        } else {
          const content = await readFile(actualPath);
          etag = `"${createHash("md5").update(content).digest("hex")}"`;
        }

        const validators: Record<string, string> = {
          ETag: etag,
          "Cache-Control": contentHashed ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL,
          // 同一个 URL 会因 Accept-Encoding 返回 br / gzip / 原文三种实体，
          // 必须声明，否则共享缓存可能把 br 的实体回给不支持 br 的客户端。
          Vary: "Accept-Encoding",
        };
        if (encoding) validators["Content-Encoding"] = encoding;

        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, validators);
          res.end();
          return;
        }

        const headers: Record<string, string> = {
          "Content-Type": mime,
          ...validators,
          "Content-Length": String(servedStat.size),
        };
        res.writeHead(200, headers);
        // 流式回传，避免把上 MB 的 chunk 整份读进内存。
        createReadStream(actualPath)
          .on("error", () => res.destroy())
          .pipe(res);
      } catch (err) {
        console.error("WebUI request error:", err);
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    });

    wss = new WebSocketServer({
      server: httpServer,
      // 首屏 listSessions 就有数百 KB 明文 JSON（含各会话的 models/modes/usage 缓存），
      // 跨隧道时尤其贵；小消息（事件推送）不压缩，避免 CPU 开销。
      perMessageDeflate: { threshold: 1024 },
    });

    wss.on("connection", (ws, req) => {
      // Authenticate via cookie (browser sends it automatically) or ?token= fallback
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const token = url.searchParams.get("token") || getTokenFromCookie(req);

      if (token !== currentToken) {
        ws.close(4001, "Unauthorized");
        return;
      }

      connectedClients.add(ws);

      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "request") {
            const { id, channel, params } = msg;
            try {
              if (channel === "registerClient") {
                const clientId = params?.clientId;
                if (typeof clientId === "string" && clientId.length > 0) {
                  clientIdsBySocket.set(ws, clientId);
                }
              }
              if (!backendHandlers) throw new Error("Handlers not initialized");
              const handler = (backendHandlers as Record<string, unknown>)[channel];
              if (typeof handler !== "function") {
                throw new Error(`Handler for ${channel} not found`);
              }
              const response = await handler(params, { transport: "webui" });
              ws.send(JSON.stringify({ type: "response", id, response }));
            } catch (err) {
              ws.send(JSON.stringify({ type: "response", id, error: extractErrorMessage(err) }));
            }
          }
        } catch (err) {
          console.error("WebUI WS message error:", err);
        }
      });

      ws.on("close", () => {
        connectedClients.delete(ws);
        const clientId = clientIdsBySocket.get(ws);
        if (clientId) {
          void backendHandlers?.killTerminalsByClient({ clientId });
        }
      });
    });

    return new Promise((resolve, reject) => {
      const listenPort = options?.port && options.port > 0 ? options.port : 0;
      httpServer!.listen(listenPort, "0.0.0.0", () => {
        isEnabled = true;
        resolve({ url: getWebUIUrl(httpServer!.address()) });
      });
      httpServer!.on("error", reject);
    });
  }

  function stop() {
    isEnabled = false;
    currentToken = null;
    for (const client of connectedClients) {
      client.close();
    }
    connectedClients.clear();

    if (wss) {
      wss.close();
      wss = null;
    }
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
  }

  function getStatus() {
    if (!isEnabled || !httpServer) return { enabled: false, url: null };
    return { enabled: true, url: getWebUIUrl(httpServer.address()) };
  }

  function getAccessInfo() {
    if (!isEnabled || !httpServer) return { enabled: false, port: null, token: null };
    const address = httpServer.address();
    const port = address && typeof address !== "string" ? address.port : null;
    return { enabled: true, port, token: currentToken };
  }

  function getWebUIUrl(addressInfo: string | AddressInfo | null) {
    const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
    if (!addressInfo) {
      return "";
    }
    // For a server listening on a pipe or Unix domain socket, the name is returned as a string.
    if (typeof addressInfo === "string") {
      return `file:///${addressInfo}?token=${currentToken}`;
    }
    if (isDev) {
      const renderUrl = new URL(process.env.ELECTRON_RENDERER_URL!);
      renderUrl.searchParams.set("token", currentToken!);
      renderUrl.searchParams.set("port", addressInfo.port.toString());
      return renderUrl.toString();
    } else {
      // In production, the WebUI is just the frontend built files,
      // but right now it's just the electron renderer.
      // Since we don't serve static files from this node server yet,
      // this url is mostly useful if we later serve the vite build output.
      // For now, we return the websocket base address or a placeholder.
      return `http://${getLocalIP()}:${addressInfo.port}/?token=${currentToken}`;
    }
  }

  return {
    broadcastEvent,
    start,
    stop,
    getStatus,
    getAccessInfo,
    setHandlers: (handlers: BackendHandlers) => {
      backendHandlers = handlers;
    },
  };
}
