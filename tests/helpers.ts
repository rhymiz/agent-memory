import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/application";
import { startHttpServer } from "../src/api/server";
import { openDatabase } from "../src/db/database";
import { MemoryClient } from "../src/client/memory-client";
import { normalized, type EmbeddingModel } from "../src/domain/embedding";

// Deterministic injected model for service/transport tests. Real inference has its own tests.
export class TestEmbeddingModel implements EmbeddingModel {
  readonly id: string = "test-token-embedding-v1";
  readonly dimensions = 1024;
  async embedQuery(text: string): Promise<Float32Array> {
    const vector = new Float32Array(this.dimensions);
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [text]) {
      let hash = 2166136261;
      for (const char of word)
        hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      const index = (hash >>> 0) % this.dimensions;
      vector[index] = (vector[index] ?? 0) + 1;
    }
    return normalized(vector, this.dimensions);
  }
  async embedDocument(text: string): Promise<Float32Array[]> {
    return [await this.embedQuery(text)];
  }
}

export function fixture(model: EmbeddingModel = new TestEmbeddingModel()) {
  const directory = mkdtempSync(join(tmpdir(), "agent-memory-test-"));
  const dbPath = join(directory, "memory.sqlite");
  const db = openDatabase(dbPath);
  let time = 1_789_063_200_000;
  const app = createApplication(
    db,
    { defaultTtlSeconds: 300, maxTtlSeconds: 3600 },
    model,
    () => time,
  );
  const http = startHttpServer(app, { host: "127.0.0.1", port: 0 });
  const baseUrl = http.url.href;
  return {
    directory,
    dbPath,
    db,
    model,
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
