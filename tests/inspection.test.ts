import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createApplication } from "../src/application";
import { fixture, TestEmbeddingModel, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});

test("embedding coverage is specific to the running model", async () => {
  await f.client().remember({ type: "fact", content: "Knowledge" });
  class NextModel extends TestEmbeddingModel {
    override readonly id = "next-model";
  }
  const app = createApplication(
    f.db,
    { defaultTtlSeconds: 300, maxTtlSeconds: 3600 },
    new NextModel(),
  );
  expect(app.inspection.stats({}).embeddings).toEqual({
    modelId: "next-model",
    memories: 0,
    chunks: 0,
    models: [f.model.id],
  });
  await app.memories.reindex();
  expect(app.inspection.stats({}).embeddings).toEqual({
    modelId: "next-model",
    memories: 1,
    chunks: 1,
    models: ["next-model"],
  });
});

test("operator pages discover projects from every domain and traverse memories without search", async () => {
  const client = f.client();
  const memories = [];
  for (let i = 0; i < 5; i++)
    memories.push(
      await client.remember({
        type: "fact",
        content: `Record ${i}`,
        metadata: { files: ["src/main.ts"] },
      }),
    );
  await f
    .client("a", "context-only")
    .updateContext({ expectedVersion: 0, content: "Read AGENTS.md" });
  await f
    .client("a", "decision-only")
    .recordDecision({ subject: "Storage", decision: "SQLite" });
  const claim = await f
    .client("a", "activity-only")
    .claim({ resource: "phase:done" });
  await f.client("a", "activity-only").releaseClaim(claim.id);
  await f.client("a", "claim-only").claim({ resource: "phase:work" });
  let after: string | undefined;
  const projects: string[] = [];
  do {
    const result = await client.listProjects({ limit: 2, after });
    projects.push(...result.items.map((item) => item.projectId));
    after = result.nextCursor ?? undefined;
  } while (after);
  expect(projects).toEqual([
    "activity-only",
    "claim-only",
    "context-only",
    "decision-only",
    "test-project",
  ]);
  const first = await client.listMemories({ limit: 2 });
  expect(first.items).toEqual(memories.slice(0, 2));
  const cursor = first.nextCursor!;
  await client.deleteMemory(cursor, 1);
  const second = await client.listMemories({ limit: 2, after: cursor });
  expect(second.items).toEqual(memories.slice(2, 4));
  const third = await client.listMemories({
    limit: 2,
    after: second.nextCursor!,
  });
  expect(third).toEqual({ items: memories.slice(4), nextCursor: null });
  expect(await f.client("a", "missing").listMemories()).toEqual({
    items: [],
    nextCursor: null,
  });
});

test("stats are scoped, count bytes and current vectors, and report expired leases without cleanup", async () => {
  const client = f.client();
  const fact = await client.remember({ type: "fact", content: "東京" });
  await client.remember({ type: "result", content: "done" });
  await client.updateMemory(fact.id, { expectedVersion: 1, content: "東京😀" });
  const old = await client.recordDecision({
    subject: "Storage",
    decision: "Old",
  });
  await client.recordDecision({
    subject: "Storage",
    decision: "New",
    supersedesId: old.id,
  });
  await client.updateContext({ expectedVersion: 0, content: "Index" });
  await client.claim({ resource: "phase:expired", ttlSeconds: 1 });
  await client.claim({ resource: "phase:active" });
  await f.client("a", "other").remember({ type: "note", content: "other" });
  f.advance(1000);
  const before = f.db.query("SELECT COUNT(*) AS count FROM activity").get();
  const stats = await client.corpusStats({ projectId: "test-project" });
  expect(stats).toMatchObject({
    asOf: f.time,
    projects: 1,
    memories: { total: 2, contentBytes: 14 },
    decisions: { active: 1, superseded: 1 },
    contexts: 1,
    claims: { active: 1, expired: 1 },
    embeddings: { memories: 2, chunks: 2, models: [f.model.id] },
    activity: { knowledge: 7, coordination: 2 },
  });
  expect(
    stats.memories.byType.find((item) => item.type === "fact")?.count,
  ).toBe(1);
  expect(f.db.query("SELECT COUNT(*) AS count FROM activity").get()).toEqual(
    before,
  );
  expect((await client.corpusStats()).memories.total).toBe(3);
  expect((await client.corpusStats({ projectId: "missing" })).projects).toBe(0);
});

test("inspection HTTP and MCP agree and reject invalid cursors, filters and scope", async () => {
  const client = f.client();
  await client.remember({ type: "fact", content: "Reusable", importance: 0.8 });
  const mcp = new Client(
    { name: "inspection", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
    );
    for (const item of [
      {
        name: "projects_list",
        args: {},
        expected: await client.listProjects(),
      },
      { name: "corpus_stats", args: {}, expected: await client.corpusStats() },
      {
        name: "memory_list",
        args: {
          projectId: "test-project",
          types: ["fact"],
          minImportance: 0.7,
        },
        expected: await client.listMemories({
          types: ["fact"],
          minImportance: 0.7,
        }),
      },
    ]) {
      const result = await mcp.callTool({
        name: item.name,
        arguments: item.args,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(item.expected);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(item.expected) },
      ]);
    }
    for (const path of [
      "/projects?after=../bad",
      "/projects?limit=0",
      "/stats?unknown=true",
      "/memories?projectId=test-project&types=fact,fact",
      "/memories?projectId=test-project&minImportance=2",
    ])
      expect((await fetch(new URL(path, f.baseUrl))).status).toBe(400);
    expect(
      (
        await mcp.callTool({
          name: "memory_list",
          arguments: { projectId: "test-project", types: [] },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await mcp.close();
  }
});
