# murmur-mcp-host — Railway deployment
#
# Builds the monorepo, then runs the hosted Murmur MCP server.
# Env (set in Railway):
#   PORT                    — Railway injects this
#   MURMUR_HOST_TOKENS     — JSON object { userId: token, ... } (REQUIRED)
#   MURMUR_HOST_DATA       — default ./data; usually leave unset (ephemeral
#                            disk). For persistence mount a volume at /data.

FROM node:22-slim
WORKDIR /app
RUN echo PROBE_OK && ls -la
CMD ["node", "-e", "console.log('probe up')"]
