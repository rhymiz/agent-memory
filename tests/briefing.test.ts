import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { projectBriefing, type BriefingSection } from "../src/domain/contracts";
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
const actor = { projectId: "test-project", agentId: "agent-a" };
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});

test("uninitialized projects have empty context and optional sections avoid unrelated retrieval", async () => {
  const embed = spyOn(f.model, "embedQuery");
  expect(
    await f
      .client()
      .getBriefing({ query: "test", sections: ["context", "claims"] }),
  ).toEqual({
    projectId: "test-project",
    context: { items: [], hasMore: false },
    claims: { items: [], hasMore: false },
  });
  expect(embed).not.toHaveBeenCalled();
  expect(f.app.activity.recent(actor).items).toEqual([]);
  expect(() => f.app.context.get(actor)).toThrow(
    "Project context has not been created",
  );
});

test("briefings expose knowledge changes despite lease churn, active claims, and current references", async () => {
  const memory = await f.client().remember({
    type: "result",
    content: "ZEPHYR_42 passed the offline checks.",
  });
  const since = f.time;
  f.advance(1);
  await f.client().updateContext({
    expectedVersion: 0,
    content: "ZEPHYR_42 uses local SQLite.",
  });
  for (let i = 0; i < 30; i++) {
    const claim = await f
      .client()
      .claim({ resource: `file:src/churn-${i}.ts` });
    await f.client().releaseClaim(claim.id);
  }
  const active = await f.client().claim({ resource: "file:src/active.ts" });
  await f.client().claim({ resource: "file:src/expired.ts", ttlSeconds: 1 });
  f.advance(1000);
  const old = await f
    .client()
    .recordDecision({ subject: "Storage", decision: "Use a server database" });
  const current = await f.client().recordDecision({
    subject: "Storage",
    decision: "Use SQLite",
    supersedesId: old.id,
  });
  const briefing = await f.client().getBriefing({ query: "ZEPHYR_42", since });
  expect(briefing.claims?.items.map((item) => item.id)).toEqual([active.id]);
  expect(briefing.context?.items[0]?.excerpt.text).toBe(
    "ZEPHYR_42 uses local SQLite.",
  );
  expect(briefing.memories?.items[0]?.id).toBe(memory.id);
  expect(briefing.decisions).toEqual({ items: [], hasMore: false });
  expect(
    briefing.activity?.items.every((item) => !item.type.startsWith("claim.")),
  ).toBe(true);
  const event = briefing.activity?.items.find(
    (item) => item.reference?.id === memory.id,
  );
  expect(event?.excerpt.text).toBe(memory.content);
  expect(event?.reference).toEqual({
    kind: "memory",
    id: memory.id,
    version: 1,
  });
  expect(
    (
      await f
        .client()
        .getBriefing({ query: "Storage", sections: ["decisions"] })
    ).decisions?.items.map((item) => item.id),
  ).toEqual([current.id]);
  const knowledge = await f
    .client()
    .recentActivity({ category: "knowledge", limit: 200 });
  expect(knowledge.items.every((item) => !item.type.startsWith("claim."))).toBe(
    true,
  );
  expect(
    (await f.client().recentActivity({ category: "coordination" })).items.every(
      (item) => item.type.startsWith("claim."),
    ),
  ).toBe(true);
  await f.client().deleteMemory(memory.id, 1);
  const deleted = await f
    .client()
    .getBriefing({ query: "ZEPHYR_42", sections: ["activity", "memories"] });
  expect(deleted.memories?.items).toEqual([]);
  expect(
    deleted.activity?.items.find((item) => item.type === "memory.deleted")
      ?.reference,
  ).toEqual({ kind: "memory", id: memory.id, version: null });
  expect(
    await f
      .client("other", "other-project")
      .getBriefing({ query: "ZEPHYR_42", sections: ["claims", "activity"] }),
  ).toEqual({
    projectId: "other-project",
    claims: { items: [], hasMore: false },
    activity: { items: [], hasMore: false },
  });
});

test("every briefing section fits the total UTF-8 budget and discloses omissions", async () => {
  const content = 'ZEPHYR_42 😀東京\n\t"'.repeat(3000);
  await f.client().updateContext({ expectedVersion: 0, content });
  for (let i = 0; i < 12; i++) {
    await f.client().remember({ type: "result", content });
    await f.client().claim({
      resource: `file:${"x".repeat(900)}-${i}`,
      intent: content.slice(0, 2000),
    });
    await f
      .client()
      .recordDecision({ subject: "東京".repeat(100), decision: content });
  }
  const sections: BriefingSection[] = [
    "context",
    "memories",
    "claims",
    "decisions",
    "activity",
  ];
  for (const maxBytes of [1024, 4096, 20_000, 64_000]) {
    const briefing = await f
      .client()
      .getBriefing({ query: "ZEPHYR_42", maxBytes, sections });
    expect(
      new TextEncoder().encode(JSON.stringify(briefing)).length,
    ).toBeLessThanOrEqual(maxBytes);
    expect(briefing.claims?.hasMore).toBe(true);
    expect(briefing.memories?.hasMore).toBe(true);
    expect(briefing.decisions?.hasMore).toBe(true);
    if (briefing.context?.items.length)
      expect(briefing.context.items[0]?.excerpt.truncated).toBe(true);
    else expect(briefing.context?.hasMore).toBe(true);
  }
});

test("briefing MCP and HTTP return equivalent typed data and reject invalid boundaries", async () => {
  await f.client().remember({ type: "fact", content: "ZEPHYR_42 is local." });
  const mcp = new Client(
    { name: "briefing-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
    );
    const result = await mcp.callTool({
      name: "project_briefing",
      arguments: { projectId: "test-project", query: "ZEPHYR_42" },
    });
    expect(result.isError).not.toBe(true);
    const briefing = projectBriefing.parse(result.structuredContent);
    expect(briefing).toEqual(
      await f.client().getBriefing({ query: "ZEPHYR_42" }),
    );
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ]);
    for (const invalid of [
      { sections: [] },
      { sections: ["claims", "claims"] },
      { sections: ["everything"] },
      { maxBytes: 1 },
      { query: " " },
      { unknown: true },
    ]) {
      const body = { query: "ZEPHYR_42", ...invalid };
      const response = await fetch(
        new URL("/projects/test-project/briefing", f.baseUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      expect(response.status).toBe(400);
      expect(
        (
          await mcp.callTool({
            name: "project_briefing",
            arguments: { projectId: "test-project", ...body },
          })
        ).isError,
      ).toBe(true);
    }
    const override = await fetch(
      new URL("/projects/test-project/briefing", f.baseUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "other", query: "test" }),
      },
    );
    expect(override.status).toBe(400);
  } finally {
    await mcp.close();
  }
});
