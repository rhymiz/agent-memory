import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/application";
import { startHttpServer } from "../src/api/server";
import { openDatabase } from "../src/db/database";
import { MemoryClient } from "../src/client/memory-client";

export function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "agent-memory-test-"));
  const dbPath = join(directory, "memory.sqlite");
  const db = openDatabase(dbPath);
  let time = 1_789_063_200_000;
  const app = createApplication(
    db,
    { defaultTtlSeconds: 300, maxTtlSeconds: 3600 },
    () => time,
  );
  const http = startHttpServer(app, { host: "127.0.0.1", port: 0 });
  const baseUrl = http.url.href;
  return {
    directory,
    dbPath,
    db,
    app,
    http,
    baseUrl,
    advance(ms: number) {
      time += ms;
    },
    get time() {
      return time;
    },
    client(agentId = "agent-a", projectId = "test-project") {
      return new MemoryClient({ baseUrl, agentId, projectId });
    },
    async close() {
      await http.stop(true);
      db.close(true);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
export type Fixture = ReturnType<typeof fixture>;
