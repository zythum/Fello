import type { AddressInfo } from "net";
import { createServer, type Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { randomBytes } from "crypto";
import { networkInterfaces } from "os";
import { join } from "path";
import { readFile, stat } from "fs/promises";
import { backendHandlers } from "./backend";
import { parseFileRoute, serveRoute } from "./file-routes";
import type { FelloIPCSchema } from "../shared/schema";
import { extractErrorMessage } from "./utils";
import * as mimeTypes from "mime-types";

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let currentToken: string | null = null;
let isEnabled = false;

// We need a way to broadcast events to all authenticated WS clients.
const connectedClients = new Set<WebSocket>();
const clientIdsBySocket = new WeakMap<WebSocket, string>();

const COOKIE_NAME = "fello_token";

/** Extract token from Cookie header. */
function getTokenFromCookie(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const cookieHeader = req.headers["cookie"];
  if (!cookieHeader) return null;
  const cookies = (Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader).split(";");
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

export function broadcastWebUIEvent<K extends keyof FelloIPCSchema["events"]>(
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

export async function startWebUI(options?: {
  port?: number;
  token?: string;
}): Promise<{ url: string }> {
  if (isEnabled && httpServer) {
    return { url: getWebUIUrl(httpServer.address()) };
  }

  stopWebUI();

  currentToken =
    options?.token && options.token.trim() !== ""
      ? options.token.trim()
      : randomBytes(16).toString("hex");

  httpServer = createServer(async (req, res) => {
    // CORS for dev environment
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === 'GET' && req.url === '/favicon.ico') {
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
    //   /automation/<scheduleId>/<taskId>/<relativePath>
    {
      const route = parseFileRoute(url);
      if (route) {
        const result = await serveRoute(route);
        res.writeHead(result.status, { "Content-Type": result.mimeType });
        res.end(result.body);
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
      let filePath = join(baseDir, reqPath);

      let s = await stat(filePath).catch(() => null);
      if (!s || s.isDirectory()) {
        filePath = join(baseDir, "index.html");
      }

      const mime = mimeTypes.lookup(filePath) || "application/octet-stream";

      const content = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": mime,
      });
      res.end(content);
    } catch (err) {
      console.error("WebUI request error:", err);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  wss = new WebSocketServer({ server: httpServer });

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
            const handler = (backendHandlers as Record<string, unknown>)[channel];
            if (typeof handler !== "function") {
              throw new Error(`Handler for ${channel} not found`);
            }
            const response = await handler(params);
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
        void backendHandlers.killTerminalsByClient({ clientId });
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

export function stopWebUI() {
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

export function getWebUIStatus() {
  if (!isEnabled || !httpServer) return { enabled: false, url: null };
  return { enabled: true, url: getWebUIUrl(httpServer.address()) };
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
