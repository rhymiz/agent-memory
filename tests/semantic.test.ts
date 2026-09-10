import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createApplication } from "../src/application";
import { memoriesResult, memorySchema } from "../src/domain/contracts";
import { cosine } from "../src/domain/embedding";
import { LocalEmbeddingModel } from "../src/embeddings/model";
import { fixture, TestEmbeddingModel } from "./helpers";

const actor = { projectId: "test-project", agentId: "agent-a" };
const policy = { defaultTtlSeconds: 300, maxTtlSeconds: 3600 };

class ControlledModel extends TestEmbeddingModel {
  gate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  entered = Promise.withResolvers<void>();
  fail = false;
  documents = 0;
  override async embedDocument(text: string): Promise<Float32Array[]> {
    this.documents++;
    this.entered.resolve();
    await this.gate?.promise;
    if (this.fail) throw new Error("inference unavailable");
    return super.embedDocument(text);
  }
}

test("inference failures leave memory, search and activity unchanged", async () => {
  const model = new ControlledModel();
  const f = fixture(model);
  try {
    const original = await f
      .client()
      .remember({ type: "fact", content: "originaltoken" });
    const embeddings = f.db.query("SELECT * FROM memory_embeddings").all();
    model.fail = true;
    await expect(
      f.app.memories.remember({ ...actor, type: "fact", content: "newtoken" }),
    ).rejects.toThrow("inference unavailable");
    await expect(
      f.app.memories.update({
        ...actor,
        memoryId: original.id,
        expectedVersion: 1,
        content: "newtoken",
      }),
    ).rejects.toThrow("inference unavailable");
    expect(await f.client().getMemory(original.id)).toEqual(original);
    expect(f.db.query("SELECT * FROM memory_embeddings").all()).toEqual(
      embeddings,
    );
    expect(f.app.activity.recent(actor).items).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("a correction cannot resurrect a memory deleted during inference; drain waits for the operation", async () => {
  const model = new ControlledModel();
  const f = fixture(model);
  try {
    const memory = await f
      .client()
      .remember({ type: "fact", content: "originaltoken" });
    model.gate = Promise.withResolvers<void>();
    model.entered = Promise.withResolvers<void>();
    const update = f.app.memories.update({
      ...actor,
      memoryId: memory.id,
      expectedVersion: 1,
      content: "correctedtoken",
    });
    const settled = update.then(
      () => null,
      (error: unknown) => error,
    );
    await model.entered.promise;
    let drained = false;
    const draining = f.app.memories.drain().then(() => {
      drained = true;
    });
    f.app.memories.delete({
      ...actor,
      memoryId: memory.id,
      expectedVersion: 1,
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    model.gate.resolve();
    expect(await settled).toMatchObject({ code: "MEMORY_NOT_FOUND" });
    await draining;
    expect(f.db.query("SELECT * FROM memory_embeddings").all()).toEqual([]);
    expect(f.db.query("SELECT * FROM memories").all()).toEqual([]);
  } finally {
    model.gate?.resolve();
    await f.close();
  }
});

test("concurrent corrections commit exactly one version with its corresponding vectors", async () => {
  const model = new ControlledModel();
  const f = fixture(model);
  try {
    const memory = await f
      .client()
      .remember({ type: "fact", content: "originaltoken" });
    model.gate = Promise.withResolvers<void>();
    const operations = ["alphatoken", "betatoken"].map((content) =>
      f.app.memories.update({
        ...actor,
        memoryId: memory.id,
        expectedVersion: 1,
        content,
      }),
    );
    model.gate.resolve();
    const results = await Promise.allSettled(operations);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const latest = f.app.memories.get({ ...actor, memoryId: memory.id });
    expect(latest.version).toBe(2);
    expect((await f.client().search({ query: latest.content })).items).toEqual([
      latest,
    ]);
    const other = latest.content === "alphatoken" ? "betatoken" : "alphatoken";
    expect((await f.client().search({ query: other })).items).toEqual([]);
    expect(
      f.db.query("SELECT memory_version FROM memory_embeddings").all(),
    ).toEqual([{ memory_version: 2 }]);
  } finally {
    await f.close();
  }
});

test("backfill is resumable, skips current vectors, and rebuilds for a changed model identity", async () => {
  const model = new ControlledModel();
  const f = fixture(model);
  try {
    const memory = await f
      .client()
      .remember({ type: "fact", content: "originaltoken" });
    // Represents an existing database immediately after the embedding migration.
    f.db.query("DELETE FROM memory_embeddings").run();
    expect(await f.app.memories.reindex()).toBe(1);
    const calls = model.documents;
    expect(await f.app.memories.reindex()).toBe(0);
    expect(model.documents).toBe(calls);
    class NewModel extends ControlledModel {
      override readonly id = "next-model";
    }
    const next = createApplication(f.db, policy, new NewModel());
    expect(await next.memories.reindex()).toBe(1);
    expect(
      f.db
        .query("SELECT model_id, memory_version FROM memory_embeddings")
        .all(),
    ).toEqual([{ model_id: "next-model", memory_version: memory.version }]);
    expect(f.app.activity.recent(actor).items).toHaveLength(1);
    expect(next.memories.get({ ...actor, memoryId: memory.id })).toEqual(
      memory,
    );
  } finally {
    await f.close();
  }
});

test("activity failures roll back vectors along with inserts, corrections and deletions", async () => {
  const f = fixture();
  try {
    const memory = await f
      .client()
      .remember({ type: "fact", content: "originaltoken" });
    const before = f.db.query("SELECT * FROM memory_embeddings").all();
    f.db.exec(
      "CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'event failure'); END",
    );
    await expect(
      f.app.memories.remember({ ...actor, type: "fact", content: "newtoken" }),
    ).rejects.toThrow("event failure");
    await expect(
      f.app.memories.update({
        ...actor,
        memoryId: memory.id,
        expectedVersion: 1,
        content: "newtoken",
      }),
    ).rejects.toThrow("event failure");
    expect(() =>
      f.app.memories.delete({
        ...actor,
        memoryId: memory.id,
        expectedVersion: 1,
      }),
    ).toThrow("event failure");
    expect(f.db.query("SELECT * FROM memory_embeddings").all()).toEqual(before);
  } finally {
    await f.close();
  }
});

describe("real offline EmbeddingGemma retrieval", () => {
  let model: LocalEmbeddingModel;
  beforeAll(async () => {
    model = await LocalEmbeddingModel.load();
  }, 30_000);
  afterAll(async () => {
    await model?.close();
  });

  test("semantic paraphrases cross HTTP and MCP, stay project scoped, and disappear after correction/deletion", async () => {
    const f = fixture(model);
    const mcp = new Client(
      { name: "semantic-test", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
      );
      const lease = await f.client().remember({
        type: "constraint",
        content: "Acquire an exclusive resource lease before changing code.",
      });
      const profile = memorySchema.parse(
        (
          await mcp.callTool({
            name: "memory_remember",
            arguments: {
              ...actor,
              type: "fact",
              content:
                "Public organization profiles must remain accessible without authentication.",
            },
          })
        ).structuredContent,
      );
      await f.client().remember({
        type: "note",
        content: "Avocados ripen faster alongside bananas.",
      });
      await f.client("agent-b", "another-project").remember({
        type: "fact",
        content: "Company pages can be viewed without signing in.",
      });
      const query = "Can visitors view company pages without signing in?";
      expect(
        f.db
          .query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?")
          .all('"visitors" AND "company" AND "pages"'),
      ).toEqual([]);
      const http = await f.client().search({ query, limit: 1 });
      expect(http.items).toEqual([profile]);
      expect(
        memoriesResult.parse(
          (
            await mcp.callTool({
              name: "memory_search",
              arguments: { projectId: actor.projectId, query, limit: 1 },
            })
          ).structuredContent,
        ),
      ).toEqual(http);
      expect(
        (
          await f.client().search({
            query: "How do we stop two agents editing the same file?",
            limit: 1,
          })
        ).items,
      ).toEqual([lease]);
      const updated = await f.client().updateMemory(profile.id, {
        expectedVersion: 1,
        content: "Invoices are retained for seven years.",
      });
      expect(
        (await f.client().search({ query })).items.some(
          (item) => item.id === profile.id,
        ),
      ).toBe(false);
      expect(
        (
          await f.client().search({
            query: "How long should billing records be kept?",
            limit: 1,
          })
        ).items,
      ).toEqual([updated]);
      await f.client().deleteMemory(updated.id, updated.version);
      expect(
        (
          await f
            .client()
            .search({ query: "How long should billing records be kept?" })
        ).items,
      ).toEqual([]);
      expect(
        (
          await f
            .client()
            .search({ query: "Which database table stores invoices?" })
        ).items,
      ).toEqual([]);
      expect(
        (await f.client("agent", "empty-project").search({ query })).items,
      ).toEqual([]);
    } finally {
      await mcp.close();
      await f.close();
    }
  }, 30_000);

  test("indexes content beyond the context window, deduplicates chunks, and keeps exact identifiers searchable", async () => {
    const f = fixture(model);
    try {
      const long = await f.client().remember({
        type: "note",
        content:
          "Bananas are tropical yellow fruit. ".repeat(350) +
          "\n\nPublic organization profiles must remain accessible without authentication.",
      });
      expect(
        f.db
          .query(
            "SELECT chunk_index FROM memory_embeddings WHERE memory_id = ?",
          )
          .all(long.id).length,
      ).toBeGreaterThan(1);
      const query = "Can visitors view company pages without signing in?";
      expect((await f.client().search({ query })).items).toEqual([long]);
      const exact = await f.client().remember({
        type: "fact",
        content: "The zxq941_handler implements cursor continuation.",
      });
      expect(
        (await f.client().search({ query: "zxq941_handler", limit: 1 })).items,
      ).toEqual([exact]);
      const vector = await model.embedQuery(query);
      expect(vector).toHaveLength(768);
      expect(cosine(vector, vector)).toBeCloseTo(1, 5);
      expect((await f.client().search({ query: "(*):" })).items).toEqual([]);
    } finally {
      await f.close();
    }
  }, 60_000);
});
