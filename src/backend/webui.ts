import type { AddressInfo } from "net";
import { createServer, type Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { randomBytes } from "crypto";
import { networkInterfaces } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFile, stat } from "fs/promises";
import { backendHandlers } from "./backend";
import type { FelloIPCSchema } from "../shared/schema";
import { extractErrorMessage } from "./utils";
import * as mimeTypes from "mime-types";

const __dirname = dirname(fileURLToPath(import.meta.url));

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let currentToken: string | null = null;
let isEnabled = false;

// We need a way to broadcast events to all authenticated WS clients.
const connectedClients = new Set<WebSocket>();

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
) {
  if (!isEnabled || !wss) return;
  const message = JSON.stringify({ type: "event", channel, payload });
  for (const client of connectedClients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(message);
    }
  }
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
    // Basic CORS for dev environment
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // In dev, the Vite server serves the files, so this node server is just for WS
    if (process.env.ELECTRON_RENDERER_URL) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Fello WebUI WebSocket Server is running.");
      return;
    }

    // In prod, serve the static files from the renderer directory
    try {
      const isFile = url.pathname !== "/" && !url.pathname.endsWith("/");
      let reqPath = url.pathname;
      if (!isFile) {
        reqPath = "/index.html";
      }

      // We need to resolve __dirname because this file will be compiled into `dist/main`
      // So the renderer is at `../renderer` relative to `dist/main`
      const baseDir = join(__dirname, "../renderer");
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
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const token = url.searchParams.get("token");

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
    renderUrl.searchParams.set("wsPort", addressInfo.port.toString());
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
