import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import { createApplication } from "./application";
import { startHttpServer } from "./api/server";
import { readConfig } from "./config";
import { openDatabase } from "./db/database";
import { createMcpServer } from "./mcp/server";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: bun run src/index.ts [--stdio]\nRuns local REST and MCP HTTP interfaces. --stdio also connects one parent MCP client.\nConfigure with AGENT_MEMORY_HOST, AGENT_MEMORY_PORT, AGENT_MEMORY_DB, AGENT_MEMORY_DEFAULT_CLAIM_TTL, AGENT_MEMORY_MAX_CLAIM_TTL.",
    );
    return;
  }
  if (args.some((arg) => arg !== "--stdio"))
    throw new Error("Unknown argument. Use --help for usage.");
  const config = readConfig();
  const db = openDatabase(config.dbPath);
  const app = createApplication(db, config);
  let http: ReturnType<typeof startHttpServer>;
  try {
    http = startHttpServer(app, config);
  } catch (error) {
    db.close(true);
    throw error;
  }
  let stdio: StdioServerHandle | undefined;
  let stopping = false;
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await http.stop(true);
    await stdio?.close();
    db.close(true);
    console.error(JSON.stringify({ level: "info", event: "daemon.stopped" }));
  }
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  if (args.includes("--stdio")) {
    process.stdin.once("end", () => void shutdown());
    try {
      stdio = serveStdio(() => createMcpServer(app), { legacy: "reject" });
    } catch (error) {
      await shutdown();
      throw error;
    }
  }
  console.error(
    JSON.stringify({
      level: "info",
      event: "daemon.started",
      url: http.url.href,
      database: config.dbPath,
      stdio: Boolean(stdio),
    }),
  );
}

await main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "daemon.start_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
});
