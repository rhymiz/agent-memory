import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createApplication } from "../src/application";
import { migrate } from "../src/db/migrate";
import initial from "../src/db/migrations/001_initial.sql" with { type: "text" };
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});

test("updates replace searchable content, preserve identity, and distinguish omitted fields from null", async () => {
  const a = f.client();
  const b = f.client("agent-b");
  const original = await a.remember({
    type: "observation",
    content: "Pagination uses offsettoken",
    importance: 0.8,
    metadata: { files: ["src/search.ts"] },
  });
  expect(original).toMatchObject({
    version: 1,
    updatedBy: "agent-a",
    updatedAt: f.time,
  });
  f.advance(1000);
  const updated = await b.updateMemory(original.id, {
    expectedVersion: original.version,
    content: "Pagination uses cursortoken",
  });
  expect(updated).toEqual({
    ...original,
    content: "Pagination uses cursortoken",
    version: 2,
    updatedBy: "agent-b",
    updatedAt: f.time,
  });
  expect(await a.getMemory(original.id)).toEqual(updated);
  expect((await a.search({ query: "offsettoken" })).items).toEqual([]);
  expect((await a.search({ query: "cursortoken" })).items).toEqual([updated]);
  const cleared = await a.updateMemory(original.id, {
    expectedVersion: updated.version,
    type: "fact",
    importance: null,
    metadata: null,
  });
  expect(cleared).toMatchObject({
    type: "fact",
    importance: null,
    metadata: null,
    version: 3,
    content: updated.content,
  });
  expect((await a.search({ query: "cursortoken" })).items).toEqual([cleared]);
});

test("stale update and delete fail without removing a newer correction", async () => {
  const a = f.client();
  const b = f.client("agent-b");
  const original = await a.remember({ type: "fact", content: "originaltoken" });
  const updated = await b.updateMemory(original.id, {
    expectedVersion: 1,
    content: "correctedtoken",
  });
  const expectedError = {
    code: "MEMORY_VERSION_CONFLICT",
    status: 409,
    details: { memoryId: original.id, expectedVersion: 1, actualVersion: 2 },
  };
  await expect(
    a.updateMemory(original.id, { expectedVersion: 1, content: "staletoken" }),
  ).rejects.toMatchObject(expectedError);
  await expect(a.deleteMemory(original.id, 1)).rejects.toMatchObject(
    expectedError,
  );
  expect(await a.getMemory(original.id)).toEqual(updated);
  expect((await a.recentActivity()).items.map((event) => event.type)).toEqual([
    "memory.updated",
    "memory.created",
  ]);
});

test("read, update and deletion are project scoped even when the ID is known", async () => {
  const owner = f.client();
  const other = f.client("other-agent", "other-project");
  const memory = await owner.remember({
    type: "fact",
    content: "isolatedtoken",
  });
  await expect(other.getMemory(memory.id)).rejects.toMatchObject({
    code: "MEMORY_NOT_FOUND",
    status: 404,
  });
  await expect(
    other.updateMemory(memory.id, {
      expectedVersion: 1,
      content: "replacement",
    }),
  ).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND", status: 404 });
  await expect(other.deleteMemory(memory.id, 1)).rejects.toMatchObject({
    code: "MEMORY_NOT_FOUND",
    status: 404,
  });
  expect(await owner.getMemory(memory.id)).toEqual(memory);
  expect((await other.recentActivity()).items).toEqual([]);
});

test("deletion removes content and FTS entries and records the acting agent without copying content", async () => {
  const a = f.client();
  const b = f.client("agent-b");
  const memory = await a.remember({
    type: "fact",
    content: "deletabletoken",
    metadata: { note: "privatepayload" },
  });
  expect(await b.deleteMemory(memory.id, memory.version)).toEqual({
    deleted: true,
    memoryId: memory.id,
  });
  await expect(a.getMemory(memory.id)).rejects.toMatchObject({
    code: "MEMORY_NOT_FOUND",
  });
  await expect(a.deleteMemory(memory.id, memory.version)).rejects.toMatchObject(
    { code: "MEMORY_NOT_FOUND" },
  );
  expect((await a.search({ query: "deletabletoken" })).items).toEqual([]);
  expect(f.db.query("SELECT * FROM memories").all()).toEqual([]);
  const events = (await a.recentActivity()).items;
  expect(events[0]).toMatchObject({
    type: "memory.deleted",
    agentId: "agent-b",
    metadata: { memoryId: memory.id, version: 1 },
  });
  expect(JSON.stringify(events)).not.toContain("deletabletoken");
  expect(JSON.stringify(events)).not.toContain("privatepayload");
  const next = await a.remember({ type: "fact", content: "freshcontenttoken" });
  expect((await a.search({ query: "deletabletoken" })).items).toEqual([]);
  expect((await a.search({ query: "freshcontenttoken" })).items).toEqual([
    next,
  ]);
  f.db.exec(
    "INSERT INTO memories_fts(memories_fts, rank) VALUES ('integrity-check', 1)",
  );
});

test("update and deletion roll back content, version and FTS when activity insertion fails", async () => {
  const actor = { projectId: "test-project", agentId: "agent-a" };
  const memory = await f.app.memories.remember({
    ...actor,
    type: "fact",
    content: "beforetoken",
  });
  f.db.exec(
    "CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'event failure'); END",
  );
  const target = {
    ...actor,
    memoryId: memory.id,
    expectedVersion: memory.version,
  };
  await expect(
    f.app.memories.update({ ...target, content: "aftertoken" }),
  ).rejects.toThrow("event failure");
  expect(() => f.app.memories.delete(target)).toThrow("event failure");
  expect(f.app.memories.get(target)).toEqual(memory);
  expect(
    (await f.app.memories.search({ ...actor, query: "beforetoken" })).items,
  ).toEqual([memory]);
  expect(
    (await f.app.memories.search({ ...actor, query: "aftertoken" })).items,
  ).toEqual([]);
  expect(f.app.activity.recent(actor).items).toHaveLength(1);
  f.db.exec(
    "INSERT INTO memories_fts(memories_fts, rank) VALUES ('integrity-check', 1)",
  );
});

test("simultaneous updates have exactly one winner for the observed version", async () => {
  const original = await f
    .client()
    .remember({ type: "fact", content: "initialtoken" });
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) =>
      f.client(`agent-${index}`).updateMemory(original.id, {
        expectedVersion: original.version,
        content: `winnertoken ${index}`,
      }),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  for (const result of results) {
    if (result.status === "rejected")
      expect(result.reason).toMatchObject({
        code: "MEMORY_VERSION_CONFLICT",
        status: 409,
      });
  }
  const winner = results.find((result) => result.status === "fulfilled");
  if (winner?.status !== "fulfilled") throw new Error("Missing winner");
  expect(await f.client().getMemory(original.id)).toEqual(winner.value);
  expect((await f.client().search({ query: "winnertoken" })).items).toEqual([
    winner.value,
  ]);
  expect(
    (await f.client().recentActivity({ type: "memory.updated" })).items,
  ).toHaveLength(1);
});

test("a racing update and deletion cannot both succeed", async () => {
  const a = f.client();
  const memory = await a.remember({ type: "fact", content: "racingtoken" });
  const results = await Promise.allSettled([
    a.updateMemory(memory.id, { expectedVersion: 1, content: "winner" }),
    f.client("agent-b").deleteMemory(memory.id, 1),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status !== "rejected")
    throw new Error("Missing rejected mutation");
  expect(["MEMORY_NOT_FOUND", "MEMORY_VERSION_CONFLICT"]).toContain(
    failure.reason.code,
  );
  expect((await a.recentActivity()).items).toHaveLength(2);
});

test("HTTP validates memory mutations and rejects path-ID overrides", async () => {
  const memory = await f
    .client()
    .remember({ type: "fact", content: "unchanged" });
  const base = {
    projectId: "test-project",
    agentId: "agent-a",
    expectedVersion: 1,
  };
  const invalid = [
    base,
    { ...base, content: "" },
    { ...base, content: null },
    { ...base, content: "next", expectedVersion: 0 },
    { ...base, content: "next", expectedVersion: "1" },
    { projectId: base.projectId, agentId: base.agentId, content: "next" },
    { ...base, content: "next", memoryId: "other" },
    { ...base, content: "next", version: 5 },
    { ...base, importance: 2 },
    { ...base, metadata: [] },
  ];
  for (const body of invalid) {
    const response = await fetch(new URL(`/memories/${memory.id}`, f.baseUrl), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  }
  const deletion = await fetch(new URL(`/memories/${memory.id}`, f.baseUrl), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: base.projectId, agentId: base.agentId }),
  });
  expect(deletion.status).toBe(400);
  expect(
    (await fetch(new URL(`/memories/${memory.id}`, f.baseUrl))).status,
  ).toBe(400);
  expect(await f.client().getMemory(memory.id)).toEqual(memory);
});

test("migration preserves existing memories and makes their FTS entries editable and deletable", async () => {
  const db = new Database(join(f.directory, "v1.sqlite"), {
    create: true,
    strict: true,
  });
  try {
    db.exec(initial);
    db.exec(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT; INSERT INTO schema_migrations VALUES (1, 1000)",
    );
    db.query(
      "INSERT INTO memories (id,project_id,agent_id,type,content,importance,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      "mem_original",
      "test-project",
      "original-agent",
      "fact",
      "oldtoken",
      0.5,
      '{"source":"existing"}',
      1000,
    );
    migrate(db);
    migrate(db);
    const app = createApplication(
      db,
      { defaultTtlSeconds: 300, maxTtlSeconds: 3600 },
      f.model,
      () => 2000,
    );
    const target = { projectId: "test-project", memoryId: "mem_original" };
    expect(app.memories.get(target)).toMatchObject({
      version: 1,
      agentId: "original-agent",
      updatedBy: "original-agent",
      createdAt: 1000,
      updatedAt: 1000,
      metadata: { source: "existing" },
    });
    const updated = await app.memories.update({
      ...target,
      agentId: "editor",
      expectedVersion: 1,
      content: "newtoken",
    });
    expect(
      (
        await app.memories.search({
          projectId: target.projectId,
          query: "oldtoken",
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await app.memories.search({
          projectId: target.projectId,
          query: "newtoken",
        })
      ).items,
    ).toEqual([updated]);
    app.memories.delete({
      ...target,
      agentId: "editor",
      expectedVersion: updated.version,
    });
    expect(
      (
        await app.memories.search({
          projectId: target.projectId,
          query: "newtoken",
        })
      ).items,
    ).toEqual([]);
    db.exec(
      "INSERT INTO memories_fts(memories_fts, rank) VALUES ('integrity-check', 1)",
    );
  } finally {
    db.close(true);
  }
});
