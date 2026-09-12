import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  claimGranted,
  claimsRenewed,
  renewClaimsInput,
} from "../src/domain/contracts";
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
const actor = { projectId: "test-project", agentId: "agent-a" };
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});
function acquire(resource: string, ttlSeconds = 300) {
  return f.app.claims.acquire({ ...actor, resource, ttlSeconds }).claim;
}

test("acquisition exposes the configured renewal schedule through HTTP and MCP", async () => {
  const first = await f
    .client()
    .acquireClaim({ resource: "file:src/first.ts" });
  expect(first.schedule).toEqual({
    expiresAt: first.claim.expiresAt,
    renewAfter: f.time + 150_000,
  });
  const early = await f.client().renewClaims([first.claim.id]);
  expect(early).toMatchObject({ ...first.schedule, renewedCount: 0 });
  f.advance(first.schedule.renewAfter - f.time);
  expect(await f.client().renewClaims([first.claim.id])).toMatchObject({
    renewedCount: 1,
  });
  const mcp = new Client(
    { name: "lease-schedule-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
    );
    const response = await mcp.callTool({
      name: "claim_acquire",
      arguments: {
        ...actor,
        resource: "file:src/second.ts",
        ttlSeconds: 60,
      },
    });
    expect(response.isError).not.toBe(true);
    const acquired = claimGranted.parse(response.structuredContent);
    expect(acquired.schedule).toEqual({
      expiresAt: f.time + 60_000,
      renewAfter: f.time + 30_000,
    });
    expect(response.content).toEqual([
      { type: "text", text: JSON.stringify(response.structuredContent) },
    ]);
    expect(await f.client().renewClaims([acquired.claim.id], 60)).toMatchObject(
      { ...acquired.schedule, renewedCount: 0 },
    );
    f.advance(acquired.schedule.renewAfter - f.time);
    expect(await f.client().renewClaims([acquired.claim.id], 60)).toMatchObject(
      { renewedCount: 1 },
    );
  } finally {
    await mcp.close();
  }
});

test("a 122-claim batch renews once with a compact result and one activity event", async () => {
  const claims = Array.from({ length: 122 }, (_, index) =>
    acquire(`file:src/file-${index}.ts`),
  );
  f.advance(150_000);
  const result = await f.client().renewClaims(claims.map((claim) => claim.id));
  expect(result).toEqual({
    claimCount: 122,
    renewedCount: 122,
    expiresAt: f.time + 300_000,
    renewAfter: f.time + 150_000,
  });
  expect(JSON.stringify(result).length).toBeLessThan(150);
  expect(
    f.app.claims
      .list(actor)
      .items.every((claim) => claim.expiresAt === result.expiresAt),
  ).toBe(true);
  const events = f.app.activity.recent({
    ...actor,
    type: "claim.renewed",
  }).items;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ resource: null, metadata: result });
});

test("early individual and repeated batch renewals leave expiry and activity unchanged", async () => {
  const claim = acquire("feature:one");
  const first = await f.client().renewClaims([claim.id]);
  expect(first.renewedCount).toBe(0);
  expect(first.renewAfter).toBe(f.time + 150_000);
  f.advance(149_999);
  expect(await f.client().renewClaim(claim.id)).toEqual(claim);
  expect(await f.client().renewClaims([claim.id])).toEqual(first);
  expect(
    f.app.activity.recent({ ...actor, type: "claim.renewed" }).items,
  ).toEqual([]);
  f.advance(1);
  const renewed = await f.client().renewClaims([claim.id]);
  expect(renewed.renewedCount).toBe(1);
  expect(await f.client().renewClaims([claim.id])).toEqual({
    ...renewed,
    renewedCount: 0,
  });
  expect(
    f.app.activity.recent({ ...actor, type: "claim.renewed" }).items,
  ).toHaveLength(1);
});

test("batches preserve longer leases and can extend existing five-minute claims to thirty minutes", async () => {
  const short = acquire("feature:short");
  const long = acquire("feature:long", 3600);
  const result = await f.client().renewClaims([short.id, long.id], 1800);
  expect(result).toEqual({
    claimCount: 2,
    renewedCount: 1,
    expiresAt: f.time + 1_800_000,
    renewAfter: f.time + 900_000,
  });
  expect(
    f.app.claims.list({ ...actor, resource: long.resource }).items,
  ).toEqual([long]);
  expect(await f.client().renewClaims([short.id, long.id], 1800)).toEqual({
    ...result,
    renewedCount: 0,
  });
});

test("missing, expired, non-owned and cross-project claims reject the entire batch", async () => {
  const valid = acquire("feature:valid");
  const expired = acquire("feature:expired", 1);
  const foreignOwner = f.app.claims.acquire({
    ...actor,
    agentId: "agent-b",
    resource: "feature:other-owner",
  }).claim;
  const foreignProject = f.app.claims.acquire({
    ...actor,
    projectId: "other-project",
    resource: "feature:other-project",
  }).claim;
  f.advance(150_000);
  const before = f.db.query("SELECT * FROM claims ORDER BY id").all();
  for (const [claimId, code] of [
    ["clm_missing", "CLAIM_NOT_FOUND"],
    [expired.id, "CLAIM_EXPIRED"],
    [foreignOwner.id, "CLAIM_NOT_OWNER"],
    [foreignProject.id, "CLAIM_NOT_FOUND"],
  ]) {
    await expect(
      f.client().renewClaims([valid.id, claimId!]),
    ).rejects.toMatchObject({ code, details: { claimId } });
    expect(f.db.query("SELECT * FROM claims ORDER BY id").all()).toEqual(
      before,
    );
  }
  expect(
    f.db.query("SELECT * FROM activity WHERE type = 'claim.renewed'").all(),
  ).toEqual([]);
});

test("a claim reclaimed after expiry cannot be revived or replaced through batch renewal", async () => {
  const valid = acquire("feature:valid");
  const old = acquire("feature:reclaimed", 1);
  f.advance(150_000);
  const next = f.app.claims.acquire({
    ...actor,
    agentId: "agent-b",
    resource: old.resource,
  }).claim;
  await expect(
    f.client().renewClaims([valid.id, old.id]),
  ).rejects.toMatchObject({ code: "CLAIM_NOT_FOUND" });
  expect(f.app.claims.list({ ...actor, resource: old.resource }).items).toEqual(
    [next],
  );
  expect(
    f.app.claims.list({ ...actor, resource: valid.resource }).items,
  ).toEqual([valid]);
});

test("batch activity failure rolls back every expiry", () => {
  const claims = [acquire("feature:a"), acquire("feature:b")];
  f.advance(150_000);
  f.db.exec(
    "CREATE TRIGGER fail_renewal BEFORE INSERT ON activity WHEN NEW.type = 'claim.renewed' BEGIN SELECT RAISE(ABORT, 'event failure'); END",
  );
  expect(() =>
    f.app.claims.renewMany({
      ...actor,
      claimIds: claims.map((claim) => claim.id),
    }),
  ).toThrow("event failure");
  expect(f.app.claims.list(actor).items).toEqual(claims);
});

test("concurrent batch renewals share one deadline and create only one renewal event", async () => {
  const claims = [acquire("feature:a"), acquire("feature:b")];
  f.advance(150_000);
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      f.client().renewClaims(claims.map((claim) => claim.id)),
    ),
  );
  expect(results.filter((result) => result.renewedCount === 2)).toHaveLength(1);
  expect(new Set(results.map((result) => result.renewAfter)).size).toBe(1);
  expect(
    f.app.activity.recent({ ...actor, type: "claim.renewed" }).items,
  ).toHaveLength(1);
});

test("HTTP and MCP validate batches and expose identical renewal results and errors", async () => {
  const mcp = new Client(
    { name: "batch-renewal-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
    );
    const claims = [acquire("feature:a"), acquire("feature:b")];
    const claimIds = claims.map((claim) => claim.id);
    const input = { ...actor, claimIds };
    f.advance(150_000);
    const result = await mcp.callTool({
      name: "claims_renew",
      arguments: input,
    });
    expect(result.isError).not.toBe(true);
    const renewed = claimsRenewed.parse(result.structuredContent);
    expect(await f.client().renewClaims(claimIds)).toEqual({
      ...renewed,
      renewedCount: 0,
    });
    const other = await mcp.callTool({
      name: "claims_renew",
      arguments: { ...input, agentId: "agent-b" },
    });
    expect(other.isError).toBe(true);
    expect(other.structuredContent).toMatchObject({
      error: { code: "CLAIM_NOT_OWNER" },
    });
    for (const invalid of [
      [],
      [claimIds[0], claimIds[0]],
      Array.from({ length: 501 }, (_, i) => `clm_${i}`),
    ]) {
      const body = { ...actor, claimIds: invalid };
      expect(renewClaimsInput.safeParse(body).success).toBe(false);
      const http = await fetch(new URL("/claims/renew", f.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(http.status).toBe(400);
      expect(
        (await mcp.callTool({ name: "claims_renew", arguments: body })).isError,
      ).toBe(true);
    }
    await expect(f.client().renewClaims(claimIds, 3601)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  } finally {
    await mcp.close();
  }
});
