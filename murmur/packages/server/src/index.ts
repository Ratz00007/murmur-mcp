/** murmur-mcp entry point. Shebang added by the build. stdout = MCP protocol only. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ServerContext } from "./session.js";
import { buildServer } from "./server.js";
import { runCli } from "./cli.js";
import { log } from "./logging.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const code = await runCli(argv);
  if (code !== -1) {
    process.exit(code);
  }

  const ctx = new ServerContext(process.cwd());
  const server = buildServer(ctx);
  const transport = new StdioServerTransport();

  const shutdown = (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    try {
      ctx.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    log.error(`uncaught: ${err?.stack ?? String(err)}`);
  });
  process.on("unhandledRejection", (reason) => {
    log.error(`unhandled rejection: ${String(reason)}`);
  });

  await server.connect(transport);
  log.info("murmur-mcp serving on stdio");
}

main().catch((err) => {
  log.error(`fatal: ${err?.stack ?? String(err)}`);
  process.exit(1);
});
