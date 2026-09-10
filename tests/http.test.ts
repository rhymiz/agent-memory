import { afterEach, beforeEach, expect, test } from "bun:test";
import { MemoryClientError } from "../src/client/memory-client";
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});

test("health reports database availability and package version", async () => {
  expect(await f.client().health()).toEqual({
    status: "ok",
    database: "ok",
    version: "0.1.0",
  });
});

test("full two-agent acceptance workflow including context version 3 to 4", async () => {
  const a = f.client("agent-a");
  const b = f.client("agent-b");
  const first = await a.claim({ resource: "feature:talent-search" });
  const memory = await a.remember({
    type: "observation",
    content: "Talent search uses cursor pagination",
  });
  expect((await b.search({ query: "talent search" })).items).toEqual([memory]);
  try {
    await b.claim({ resource: first.resource });
    throw new Error("Expected conflict");
  } catch (error) {
    expect(error).toBeInstanceOf(MemoryClientError);
    if (error instanceof MemoryClientError) {
      expect(error.code).toBe("CLAIM_CONFLICT");
      expect(error.status).toBe(409);
      expect(error.details?.agentId).toBe("agent-a");
    }
  }
  expect(
    (await b.recentActivity()).items.some(
      (event) => event.agentId === "agent-a",
    ),
  ).toBe(true);
  await a.releaseClaim(first.id);
  const second = await b.claim({ resource: first.resource });
  expect(second.agentId).toBe("agent-b");
  await b.releaseClaim(second.id);
  for (const expectedVersion of [0, 1, 2])
    await a.updateContext({
      expectedVersion,
      content: `Context ${expectedVersion + 1}`,
    });
  const [seenA, seenB] = await Promise.all([a.getContext(), b.getContext()]);
  expect(seenA.version).toBe(3);
  expect(seenB.version).toBe(3);
  expect(
    (
      await a.updateContext({
        expectedVersion: seenA.version,
        content: "Version four",
      })
    ).version,
  ).toBe(4);
  await expect(
    b.updateContext({
      expectedVersion: seenB.version,
      content: "Stale content",
    }),
  ).rejects.toMatchObject({ code: "CONTEXT_VERSION_CONFLICT", status: 409 });
  expect((await b.getContext()).content).toBe("Version four");
});

test("boundary validation rejects malformed bodies, unknown fields and query parameters", async () => {
  const cases = [
    { path: "/memories", method: "POST", body: "{", status: 400 },
    {
      path: "/memories",
      method: "POST",
      body: JSON.stringify({
        projectId: "p",
        agentId: "a",
        type: "unknown",
        content: "hello",
      }),
      status: 400,
    },
    {
      path: "/claims",
      method: "POST",
      body: JSON.stringify({
        projectId: "p",
        agentId: "a",
        resource: "feature:x",
        ttlSeconds: "300",
      }),
      status: 400,
    },
    {
      path: "/memories",
      method: "POST",
      body: JSON.stringify({
        projectId: "p",
        agentId: "a",
        type: "fact",
        content: "hello",
        sql: "DROP TABLE memories",
      }),
      status: 400,
    },
    { path: "/memories/search?q=hello", method: "GET", status: 400 },
    {
      path: "/memories/search?projectId=p&q=hello&limit=",
      method: "GET",
      status: 400,
    },
    {
      path: "/memories/search?projectId=p&q=hello&limit=1.5",
      method: "GET",
      status: 400,
    },
    {
      path: "/memories/search?projectId=p&q=hello&q=world",
      method: "GET",
      status: 400,
    },
    {
      path: "/projects/p/activity?projectId=other",
      method: "GET",
      status: 400,
    },
    { path: "/projects/%E0%A4%A/context", method: "GET", status: 400 },
  ];
  for (const item of cases) {
    const response = await fetch(new URL(item.path, f.baseUrl), {
      method: item.method,
      body: item.body,
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(item.status);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  }
});

test("rejects browser origins and hostile Host headers", async () => {
  for (const path of ["/health", "/mcp"]) {
    expect(
      (
        await fetch(new URL(path, f.baseUrl), {
          headers: { Origin: "https://attacker.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(new URL(path, f.baseUrl), {
          headers: { Host: "attacker.example" },
        })
      ).status,
    ).toBe(403);
  }
});

test("unknown route, wrong method and wrong media type use stable errors", async () => {
  expect((await fetch(new URL("/missing", f.baseUrl))).status).toBe(404);
  const method = await fetch(new URL("/health", f.baseUrl), { method: "PUT" });
  expect(method.status).toBe(405);
  expect(method.headers.get("allow")).toBe("GET");
  expect(
    (
      await fetch(new URL("/memories", f.baseUrl), {
        method: "POST",
        body: "hello",
      })
    ).status,
  ).toBe(415);
});

test("HTTP conflict includes both stable error code and structured owner details", async () => {
  const claim = await f.client().claim({ resource: "schema:database" });
  const response = await fetch(new URL("/claims", f.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "test-project",
      agentId: "b",
      resource: claim.resource,
    }),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    granted: false,
    conflict: { claimId: claim.id, agentId: "agent-a" },
    error: { code: "CLAIM_CONFLICT" },
  });
});
