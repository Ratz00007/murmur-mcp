# murmur-mcp-host — Railway deployment
#
# Builds the monorepo, then runs the hosted Murmur MCP server.
# Env (set in Railway):
#   PORT                    — Railway injects this
#   MURMUR_HOST_TOKENS     — JSON object { userId: token, ... } (REQUIRED)
#   MURMUR_HOST_DATA       — default ./data; usually leave unset (ephemeral
#                            disk). For persistence mount a volume at /data.

# Build context must be the monorepo root (murmur/), i.e. on Render set:
#   Root Directory            = murmurur/
#   Docker Build Context Dir  = murmurur/
#   Dockerfile Path           = packages/host/Dockerfile

FROM node:22-slim AS build
WORKDIR /app
# Node's slim image lacks a native toolchain; better-sqlite3's rebuild falls
# back to node-gyp compilation when no prebuilt binary matches, so install one.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/engine/ packages/engine/
COPY packages/prompts/ packages/prompts/
COPY packages/adapters/ packages/adapters/
COPY packages/templates/ packages/templates/
COPY packages/server/ packages/server/
COPY packages/host/ packages/host/
# --ignore-scripts skips the root "prepare" hook (which would otherwise run a
# full monorepo build during install, before we want it). Native modules are
# rebuilt explicitly below so better-sqlite3/esbuild work regardless.
RUN npm ci --ignore-scripts
RUN npm rebuild better-sqlite3
RUN node node_modules/esbuild/install.js
RUN npm run build:libs && npm run build -w murmur-mcp-host

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/host/dist ./host-dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "host-dist/index.js"]
