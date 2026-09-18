import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createApplication } from "../src/application";
import { migrate } from "../src/db/migrate";
import initial from "../src/db/migrations/001_initial.sql" with { type: "text" };
import mutations from "../src/db/migrations/002_memory_mutations.sql" with { type: "text" };
import embeddings from "../src/db/migrations/003_embeddings.sql" with { type: "text" };
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});

test("decision queries find older relevant choices before limiting, default to active, and include reasoning", async () => {
  const client = f.client();
  const old = await client.recordDecision({
    subject: "Privacy",
    decision: "Use a static URL",
    reasoning: "AIA_42 host policy",
  });
  const current = await client.recordDecision({
    subject: "Privacy",
    decision: "Resolve the host footer link",
    reasoning: "AIA_42 host policy",
    supersedesId: old.id,
  });
  for (let i = 0; i < 10; i++) {
    f.advance(1);
    await client.recordDecision({ subject: "Storage", decision: "Use SQLite" });
  }
  expect(
    (await client.listDecisions({ query: "AIA_42", limit: 1 })).items,
  ).toEqual([current]);
  expect(
    (
      await client.listDecisions({ query: "AIA_42", status: "superseded" })
    ).items.map((item) => item.id),
  ).toEqual([old.id]);
  expect(
    (await client.getBriefing({ query: "AIA_42" })).decisions?.items.map(
      (item) => item.id,
    ),
  ).toEqual([current.id]);
  expect(
    (await f.client("a", "other").listDecisions({ query: "AIA_42" })).items,
  ).toEqual([]);
  expect((await client.listDecisions({ query: '" OR ***' })).items).toEqual([]);
  expect((await client.listDecisions()).items).toHaveLength(12);
});

test("decision indexes migrate existing records and roll back with failed supersession", async () => {
  const db = new Database(join(f.directory, "v3.sqlite"));
  try {
    db.exec(initial);
    db.exec(mutations);
    db.exec(embeddings);
    db.exec(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT; INSERT INTO schema_migrations VALUES (1,0),(2,0),(3,0)",
    );
    db.query(
      "INSERT INTO decisions (id,project_id,subject,decision,status,agent_id,created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      "dec_old",
      "test-project",
      "Privacy",
      "footer policy",
      "active",
      "original",
      1,
    );
    migrate(db);
    migrate(db);
    const app = createApplication(
      db,
      { defaultTtlSeconds: 300, maxTtlSeconds: 3600 },
      f.model,
    );
    expect(
      app.decisions.list({ projectId: "test-project", query: "footer" })
        .items[0]?.id,
    ).toBe("dec_old");
    db.exec(
      "CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'event failure'); END",
    );
    expect(() =>
      app.decisions.record({
        projectId: "test-project",
        agentId: "a",
        subject: "Privacy",
        decision: "replacement",
        supersedesId: "dec_old",
      }),
    ).toThrow();
    expect(
      app.decisions.list({ projectId: "test-project", query: "footer" })
        .items[0]?.status,
    ).toBe("active");
    expect(
      app.decisions.list({ projectId: "test-project", query: "replacement" })
        .items,
    ).toEqual([]);
    expect(() =>
      app.decisions.record({
        projectId: "test-project",
        agentId: "a",
        subject: "new subject",
        decision: "uncommittedtoken",
      }),
    ).toThrow();
    expect(
      app.decisions.list({
        projectId: "test-project",
        query: "uncommittedtoken",
      }).items,
    ).toEqual([]);
  } finally {
    db.close();
  }
});

test("decision query results agree across MCP and HTTP", async () => {
  const client = f.client();
  await client.recordDecision({
    subject: "Pagination",
    decision: "Opaque cursor",
  });
  const expected = await client.listDecisions({ query: "cursor" });
  const mcp = new Client(
    { name: "decisions", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
    );
    const result = await mcp.callTool({
      name: "decisions_list",
      arguments: { projectId: "test-project", query: "cursor" },
    });
    expect(result.structuredContent).toEqual(expected);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(expected) },
    ]);
    expect(
      (
        await mcp.callTool({
          name: "decisions_list",
          arguments: { projectId: "test-project", query: " " },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await fetch(
          new URL("/projects/test-project/decisions?query=cursor", f.baseUrl),
        )
      ).status,
    ).toBe(400);
  } finally {
    await mcp.close();
  }
});
