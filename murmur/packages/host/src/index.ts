/**
 * murmur-mcp-host — hosted HTTP deployment of Murmur.
 *
 * Serves the MCP server over streamable-HTTP with bearer-token auth and
 * per-user workspace isolation. Each authenticated user gets their own
 * .murmur/ data directory (SQLite world store + artifacts), so worlds never
 * leak across tenants.
 *
 * Environment:
 *   PORT                 — listen port (default 8080)
 *   MURMUR_HOST_DATA     — root data dir (default ./data); users/<id> per tenant
 *   MURMUR_HOST_TOKENS   — JSON object { userId: token, ... } (required)
 *
 * This package is the explicit network surface of Murmur. It is deliberately
 * separate from the hermetic stdio server (packages/server), which ships with
 * zero network code and passes the cleanroom gate. The host wraps the same
 * engine and tools — the portability of the MCP surface is the point.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ServerContext } from "../../server/src/session.js";
import { buildServer } from "../../server/src/server.js";
import { log } from "../../server/src/logging.js";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_ROOT = path.resolve(process.env.MURMUR_HOST_DATA ?? "data");

/** { userId: token } — the only credential source. Fail closed. */
function parseTokens(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [userId, token] of Object.entries(obj)) {
      if (typeof token === "string" && token.length > 0) map.set(token, userId);
    }
  } catch {
    throw new Error("MURMUR_HOST_TOKENS must be a JSON object of { userId: token }");
  }
  return map;
}

const TOKENS = parseTokens(process.env.MURMUR_HOST_TOKENS);

interface Session {
  transport: StreamableHTTPServerTransport;
  ctx: ServerContext;
  userId: string;
}

const sessions = new Map<string, Session>();

function userIdFor(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return TOKENS.get(auth.slice(7).trim()) ?? null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function userDataDir(userId: string): string {
  // User ids are operator-chosen; keep them filesystem-safe.
  const safe = userId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = path.join(DATA_ROOT, "users", safe);
  fs.mkdirSync(path.join(dir, ".murmur"), { recursive: true });
  return dir;
}

async function createSession(userId: string): Promise<Session> {
  const ctx = new ServerContext(userDataDir(userId));
  const server = buildServer(ctx);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const session: Session = { transport, ctx, userId };
  transport.onclose = () => {
    try {
      ctx.close();
    } catch {
      /* ignore */
    }
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  return session;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const userId = userIdFor(req);
  if (!userId) {
    sendJson(res, 401, { error: "unauthorized: valid Bearer token required" });
    return;
  }

  const sid = typeof req.headers["mcp-session-id"] === "string"
    ? req.headers["mcp-session-id"]
    : undefined;

  let session: Session | undefined = sid ? sessions.get(sid) : undefined;

  if (!session) {
    // New session (initialize or SSE open): own ServerContext per user.
    session = await createSession(userId);
    await session.transport.handleRequest(req, res);
    // The session id is assigned during the handshake; register afterwards.
    const assignedId = session.transport.sessionId;
    if (assignedId) {
      sessions.set(assignedId, session);
    } else {
      session.ctx.close();
    }
    return;
  }

  await session.transport.handleRequest(req, res);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, mcp-session-id",
        "access-control-max-age": "86400",
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "murmur-mcp-host",
        sessions: sessions.size,
      });
      return;
    }

    if (url.pathname === "/mcp") {
      await handleMcp(req, res);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    log.error(`host: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "internal server error" });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  log.info(`murmur-mcp-host listening on :${PORT} (data: ${DATA_ROOT})`);
  if (TOKENS.size === 0) {
    log.warn("MURMUR_HOST_TOKENS is not set — all requests will be rejected (401)");
  }
});

const shutdown = (signal: string) => {
  log.info(`received ${signal}, shutting down`);
  for (const s of sessions.values()) {
    try {
      s.ctx.close();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
