import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { claimGranted, claimsGranted } from "../src/domain/contracts";
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});

test("a conflicting acquisition rolls back expired-lease cleanup in the same batch", async () => {
  const expired = await f
    .client()
    .claim({ resource: "file:a.ts", ttlSeconds: 1 });
  await f.client("other").claim({ resource: "file:z.ts" });
  f.advance(1000);
  const before = f.db.query("SELECT * FROM activity ORDER BY rowid").all();
  await expect(
    f.client().acquireClaims({ resources: ["file:a.ts", "file:z.ts"] }),
  ).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
  expect(f.db.query("SELECT * FROM activity ORDER BY rowid").all()).toEqual(
    before,
  );
  expect(
    f.db.query("SELECT id FROM claims WHERE id = ?").get(expired.id),
  ).toEqual({ id: expired.id });
});
afterEach(async () => {
  await f.close();
});

test("batch acquisition and release retain per-resource ownership with one event each", async () => {
  const client = f.client();
  const resources = Array.from({ length: 122 }, (_, i) => `file:src/${i}.ts`);
  const acquired = await client.acquireClaims({
    resources,
    intent: "Modify these files",
  });
  expect(acquired.claims).toHaveLength(resources.length);
  expect(acquired.advisories).toMatchObject([
    { kind: "large-claim-set", activeClaimCount: 122, threshold: 100 },
  ]);
  expect(acquired.claims.map((claim) => claim.resource)).toEqual(
    resources.toSorted(),
  );
  expect(acquired.schedule).toEqual({
    expiresAt: f.time + 300_000,
    renewAfter: f.time + 150_000,
  });
  const events = (await client.recentActivity()).items;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "claim.acquired",
    resource: null,
    metadata: { claimCount: 122 },
  });
  expect(events[0]?.metadata?.claims).toHaveLength(122);
  const ids = acquired.claims.map((claim) => claim.id);
  expect(await client.releaseClaims(ids)).toEqual({
    released: true,
    claimIds: ids,
  });
  expect((await client.listClaims()).items).toEqual([]);
  expect((await client.recentActivity()).items).toHaveLength(2);
});

test("conflicts, normalized duplicates and event failures never leave a partial batch", async () => {
  const client = f.client();
  const other = await f.client("other").claim({ resource: "file:z.ts" });
  const before = await client.recentActivity();
  await expect(
    client.acquireClaims({ resources: ["file:a.ts", "file:z.ts"] }),
  ).rejects.toMatchObject({
    code: "CLAIM_CONFLICT",
    details: { claimId: other.id },
  });
  expect((await client.listClaims()).items).toEqual([other]);
  expect(await client.recentActivity()).toEqual(before);
  await expect(
    client.acquireClaims({ resources: ["file:a.ts", "file:./a.ts"] }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    client.acquireClaims({ resources: ["file:../a.ts"] }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  f.db.exec(
    "CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'event failure'); END",
  );
  await expect(
    client.acquireClaims({ resources: ["file:a.ts", "file:b.ts"] }),
  ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  expect((await client.listClaims()).items).toEqual([other]);
});

test("batch release rejects missing, expired, foreign and non-owned members atomically", async () => {
  const client = f.client();
  const owned = await client.acquireClaims({
    resources: ["file:a.ts", "file:b.ts"],
  });
  const ids = owned.claims.map((claim) => claim.id);
  const foreign = await f
    .client("agent-a", "other")
    .claim({ resource: "file:c.ts" });
  const other = await f.client("other").claim({ resource: "file:d.ts" });
  const expired = await client.claim({ resource: "file:e.ts", ttlSeconds: 1 });
  f.advance(1000);
  for (const item of [
    { id: "missing", code: "CLAIM_NOT_FOUND" },
    { id: foreign.id, code: "CLAIM_NOT_FOUND" },
    { id: other.id, code: "CLAIM_NOT_OWNER" },
    { id: expired.id, code: "CLAIM_EXPIRED" },
  ]) {
    await expect(
      client.releaseClaims([ids[0]!, item.id]),
    ).rejects.toMatchObject({ code: item.code });
    expect(
      f.db.query("SELECT id FROM claims WHERE id = ?").get(ids[0]!),
    ).toEqual({ id: ids[0] });
  }
  f.db.exec(
    "CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'event failure'); END",
  );
  await expect(client.releaseClaims(ids)).rejects.toMatchObject({
    code: "INTERNAL_ERROR",
  });
  expect(f.db.query("SELECT id FROM claims WHERE id = ?").get(ids[1]!)).toEqual(
    { id: ids[1] },
  );
});

test("concurrent batches have one owner and do not imply directory coverage", async () => {
  const results = await Promise.allSettled(
    [f.client("a"), f.client("b")].map((client) =>
      client.acquireClaims({ resources: ["file:a.ts", "file:b.ts"] }),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const active = (await f.client().listClaims()).items;
  expect(active).toHaveLength(2);
  expect(new Set(active.map((claim) => claim.agentId)).size).toBe(1);
  await f
    .client()
    .acquireClaims({ resources: ["directory:src", "file:src/a.ts"] });
});

test("claim-size advisories count only this owner's active project leases and never block acquisition", async () => {
  const client = f.client();
  const resources = Array.from({ length: 100 }, (_, i) => `file:src/${i}.ts`);
  await f.client("other").acquireClaims({
    resources: resources.map((resource) => `${resource}.other`),
  });
  await f.client("agent-a", "other-project").acquireClaims({ resources });
  await client.acquireClaims({
    resources: resources.map((resource) => `${resource}.expired`),
    ttlSeconds: 1,
  });
  f.advance(1000);
  const atThreshold = await client.acquireClaims({ resources });
  expect(atThreshold.advisories).toEqual([]);
  const aboveThreshold = await client.acquireClaim({ resource: "file:extra" });
  expect(aboveThreshold.advisories).toMatchObject([
    { kind: "large-claim-set", activeClaimCount: 101, threshold: 100 },
  ]);
  expect(
    f.db
      .query("SELECT id FROM claims WHERE id = ?")
      .get(aboveThreshold.claim.id),
  ).toEqual({ id: aboveThreshold.claim.id });
  await client.releaseClaims([
    aboveThreshold.claim.id,
    atThreshold.claims[0]!.id,
  ]);
  expect(
    (await client.acquireClaim({ resource: "file:replacement" })).advisories,
  ).toEqual([]);
});

test("generated-path advisories report normalized directories without treating names or lockfiles as forbidden", async () => {
  const acquired = await f.client().acquireClaims({
    resources: [
      "file:src/generated/../generated/query.ts",
      "directory:generated",
      "file:src/generated",
      "file:src/generated-utils.ts",
      "feature:generated/cache",
      "file:bun.lock",
    ],
  });
  expect(acquired.advisories).toMatchObject([
    {
      kind: "generated-resources",
      resources: ["directory:generated", "file:src/generated/query.ts"],
    },
  ]);
  expect(acquired.claims).toHaveLength(6);
  const single = await f
    .client()
    .acquireClaim({ resource: "file:generated/new.ts" });
  expect(single.advisories).toMatchObject([
    { kind: "generated-resources", resources: ["file:generated/new.ts"] },
  ]);
  const { advisories: _advisories, ...legacy } = single;
  expect(claimGranted.parse(legacy).advisories).toEqual([]);
});

test("batch MCP shares records, envelopes and validation with HTTP", async () => {
  const mcp = new Client(
    { name: "batches", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
    );
    const actor = { projectId: "test-project", agentId: "agent-a" };
    const result = await mcp.callTool({
      name: "claims_acquire",
      arguments: { ...actor, resources: ["file:generated/b.ts", "file:a.ts"] },
    });
    expect(result.isError).not.toBe(true);
    const acquired = claimsGranted.parse(result.structuredContent);
    expect(acquired.advisories).toMatchObject([
      { kind: "generated-resources", resources: ["file:generated/b.ts"] },
    ]);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ]);
    expect((await f.client().listClaims()).items).toEqual(acquired.claims);
    const released = await mcp.callTool({
      name: "claims_release",
      arguments: {
        ...actor,
        claimIds: acquired.claims.map((claim) => claim.id),
      },
    });
    expect(released.isError).not.toBe(true);
    expect(released.content).toEqual([
      { type: "text", text: JSON.stringify(released.structuredContent) },
    ]);
    expect((await f.client().listClaims()).items).toEqual([]);
    for (const resources of [
      [],
      Array.from({ length: 501 }, (_, i) => `file:${i}`),
      ["file:a", "file:./a"],
    ]) {
      const args = { ...actor, resources };
      expect(
        (await mcp.callTool({ name: "claims_acquire", arguments: args }))
          .isError,
      ).toBe(true);
      expect(
        (
          await fetch(new URL("/claims/acquire", f.baseUrl), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
          })
        ).status,
      ).toBe(400);
    }
  } finally {
    await mcp.close();
  }
});
