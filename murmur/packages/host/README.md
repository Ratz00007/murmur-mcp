# murmur-mcp-host

Hosted HTTP deployment of the Murmur MCP server — the same engine and 12-tool
surface over streamable-HTTP, with bearer-token auth and per-user workspace
isolation. This is the *explicit network surface* of Murmur; it is a separate
package from the hermetic stdio server (`packages/server`), which ships with
zero network code and passes the cleanroom gate.

## Live deployment (Render)

**https://murmur-mcp.onrender.com/mcp** — deployed from this monorepo's
`packages/host/Dockerfile` (Node 22, streamable-HTTP, bearer-token auth,
per-user workspaces). Verified live: `/health` → `{"ok":true,...}`, 401
without/bad token, MCP initialize 200, 12 tools listed. Render free tier
spins the instance down after inactivity (~50s cold start on first request).

## Environment

| Var | Required | Description |
|---|---|---|
| `PORT` | no | Listen port (default `8080`) |
| `MURMUR_HOST_TOKENS` | **yes** | JSON object `{ userId: token, ... }`. Requests without a matching `Authorization: Bearer <token>` get 401. Host refuses to do anything useful without it (fail closed). |
| `MURMUR_HOST_DATA` | no | Root data dir (default `./data`). Each user gets `users/<id>/` with their own `.murmur/` + SQLite world store — worlds never leak across tenants. |

## Run locally

```bash
npm run build -w murmur-mcp-host
MURMUR_HOST_TOKENS='{"alice":"secret-token"}' PORT=8080 node packages/host/dist/index.js
```

Then connect any MCP client to `http://localhost:8080/mcp` with
`Authorization: Bearer secret-token` (streamable-HTTP transport).

Verify:

```bash
curl http://localhost:8080/health          # {"ok":true,...}
# no auth → 401; bad token → 401; valid token → MCP protocol
```

## Deploy to Railway

1. Push the monorepo (this package includes a `Dockerfile`).
2. Create a new Railway service from the repo; Railway uses the Dockerfile.
3. Set env: `MURMUR_HOST_TOKENS='{"you":"$2a$...or-any-strong-token"}'`.
   Mount a volume at `/data` and set `MURMUR_HOST_DATA=/data` if worlds must
   survive redeploys.
4. Domain → Railway gives you `<service>.up.railway.app`; the endpoint is
   `https://<service>.up.railway.app/mcp`.

### Security notes

- Tokens are operator-managed via env. There is no signup UI and no OAuth
  yet; rotate tokens by editing `MURMUR_HOST_TOKENS` and redeploying.
- The SQLite store per user lives on the instance disk. For zero-downtime
  production, attach a volume (or move storage to a managed DB later).
- Free-tier Railway sleep: the instance may spin down; the MCP endpoint only
  responds while awake. For the Anthropic directory you'd want a paid plan so
  the server never sleeps.
- CORS is permissive (any origin) on the MCP endpoint — fine for agent
  clients; tighten if you add a browser client with credentials.

## Why separate from packages/server

`packages/server` is the hermetic local MCP server: zero network code,
cleanroom-gated. `packages/host` intentionally adds HTTP + auth on top of the
same engine. Keeping them apart means the cleanroom gate still proves the
stdio artifact has no network surface, while the host is honest about being a
network service. Never import host code into packages/server.
