import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import { createApplication } from "./application";
import { startHttpServer } from "./api/server";
import { readConfig } from "./config";
import { openDatabase } from "./db/database";
import { createMcpServer } from "./mcp/server";
import { LocalEmbeddingModel } from "./embeddings/model";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: memd [--stdio]\nRuns local REST and MCP HTTP interfaces with bundled offline semantic search. --stdio also connects one parent MCP client.\nConfigure with AGENT_MEMORY_HOST, AGENT_MEMORY_PORT, AGENT_MEMORY_DB, AGENT_MEMORY_RUNTIME_DIR, AGENT_MEMORY_DEFAULT_CLAIM_TTL, AGENT_MEMORY_MAX_CLAIM_TTL.",
    );
    return;
  }
  if (args.some((arg) => arg !== "--stdio"))
    throw new Error("Unknown argument. Use --help for usage.");
  const config = readConfig();
  const db = openDatabase(config.dbPath);
  let model: LocalEmbeddingModel | undefined;
  let http: ReturnType<typeof startHttpServer>;
  let app: ReturnType<typeof createApplication>;
  try {
    console.error(JSON.stringify({ level: "info", event: "search.loading" }));
    model = await LocalEmbeddingModel.load();
    app = createApplication(db, config, model);
    const indexed = await app.memories.reindex();
    console.error(
      JSON.stringify({
        level: "info",
        event: "search.ready",
        model: model.id,
        indexed,
      }),
    );
    http = startHttpServer(app, config);
  } catch (error) {
    await model?.close();
    db.close(true);
    throw error;
  }
  let stdio: StdioServerHandle | undefined;
  let stopping = false;
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await http.stop();
    await stdio?.close();
    await app.memories.drain();
    await model?.close();
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
