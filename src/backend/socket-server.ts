import { createServer, type Server } from "http";
import { dirname } from "path";
import { mkdirSync, existsSync, unlinkSync } from "fs";

/** 判断路径是否为 Windows 命名管道路径（以 \.\pipe\ 或 \?\pipe\ 开头） */
function isWindowsPipePath(p: string) {
  return /^\\\\.\\pipe\\/i.test(p);
}

export interface SocketServer {
  /** 停止 socket server 并清理 socket 文件 */
  stop: () => void;
  /** 注册路由处理器。path 不含前导斜杠，如 'ask-user' */
  registry: (path: string, handler: (payload: unknown) => unknown | Promise<unknown>) => void;
  /** socket 文件的绝对路径 */
  socketPath: string;
}

/**
 * 启动 Unix Domain Socket HTTP 服务器。
 * @param options.socketPath - 指定 socket 路径，不传则自动生成随机路径
 * 返回 { stop, registry, socketPath }，调用方通过 registry 注册路由。
 */
export async function startSocketServer(socketPath: string): Promise<SocketServer> {
  // Windows named pipe 无需文件系统操作（由 OS 管理，进程退出自动清理）
  if (!isWindowsPipePath(socketPath)) {
    // Ensure socket directory exists
    mkdirSync(dirname(socketPath), { recursive: true });

    // Clean up old socket file if exists
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
  }

  const routes = new Map<string, (payload: unknown) => unknown | Promise<unknown>>();

  const server: Server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Route matching: POST /<route>
    if (req.method === "POST") {
      const routeKey = url.pathname.replace(/^\//, ""); // strip leading slash
      const handler = routes.get(routeKey);

      if (handler) {
        const buffers: Buffer[] = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const body = Buffer.concat(buffers).toString("utf-8");

        try {
          const payload = body ? JSON.parse(body) : {};
          const result = await handler(payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          const message = err?.message || String(err);
          console.error(`[socket-server] POST /${routeKey} error:`, message);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
        return;
      }
    }

    // 404 for unmatched routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise<SocketServer>((resolve, reject) => {
    server.listen(socketPath, () => {
      // console.log(`[socket-server] Listening on ${socketPath}`);

      const serverRef: SocketServer = {
        stop: () => {
          server.close();
          server.closeAllConnections?.();
          // Windows named pipe 由 OS 自动清理，无需 unlink
          if (!isWindowsPipePath(socketPath)) {
            if (existsSync(socketPath)) {
              try {
                unlinkSync(socketPath);
              } catch {}
            }
          }
        },
        registry: (path, handler) => {
          routes.set(path, handler);
        },
        socketPath,
      };

      resolve(serverRef);
    });
    server.on("error", (err) => {
      console.error("[socket-server] Failed to start:", err);
      reject(err);
    });
  });
}
