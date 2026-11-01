# murmur-mcp-host — Railway deployment
#
# Builds the monorepo, then runs the hosted Murmur MCP server.
# Env (set in Railway):
#   PORT                    — Railway injects this
#   MURMUR_HOST_TOKENS     — JSON object { userId: token, ... } (REQUIRED)
#   MURMUR_HOST_DATA       — default ./data; usually leave unset (ephemeral
#                            disk). For persistence mount a volume at /data.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/ packages/engine/
COPY packages/prompts/ packages/prompts/
COPY packages/adapters/ packages/adapters/
COPY packages/templates/ packages/templates/
COPY packages/server/ packages/server/
COPY packages/host/ packages/host/
# Sources must be present before `npm ci`: the root "prepare" hook runs the
# full monorepo build, and it would fail on missing tsconfigs otherwise.
RUN npm ci
RUN npm run build:libs && npm run build -w murmur-mcp-host

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/host/dist ./host-dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "host-dist/index.js"]
