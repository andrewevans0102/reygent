import { createServer, type Server } from "node:http";
import { generateDashboardHtml } from "./html.js";
import { handleApiRoute } from "./routes.js";

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface DashboardServerInfo {
  server: Server;
  port: number;
  url: string;
}

export async function startDashboardServer(opts: {
  port?: number;
  since?: string;
  idleTimeoutMs?: number;
}): Promise<DashboardServerInfo> {
  const port = opts.port ?? 3141;
  const since = opts.since ?? "30d";
  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

  const html = generateDashboardHtml(since);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const server = createServer(async (req, res) => {
    // Reset idle timer on every request
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      server.close();
    }, idleTimeoutMs);

    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    // API routes
    const handled = await handleApiRoute(req, res, url);
    if (handled) return;

    // Serve dashboard HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(html);
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  return new Promise<DashboardServerInfo>((resolve, reject) => {
    server.on("error", (err) => {
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      // Start idle timer
      idleTimer = setTimeout(() => {
        server.close();
      }, idleTimeoutMs);

      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
      });
    });
  });
}
