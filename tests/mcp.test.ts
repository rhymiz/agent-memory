import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import * as c from "../src/domain/contracts";
import { errorResponse } from "../src/domain/errors";
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
let mcp: Client;
beforeEach(async () => {
  f = fixture();
  mcp = new Client(
    { name: "test-agent", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
  );
  expect(mcp.getProtocolEra()).toBe("modern");
});
afterEach(async () => {
  await mcp.close();
  await f.close();
});
const actor = { projectId: "test-project", agentId: "mcp-agent" };
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await mcp.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return result.structuredContent;
}

test("advertises all eleven tools with structured input and output schemas", async () => {
  const result = await mcp.listTools();
  expect(result.tools.map((tool) => tool.name).sort()).toEqual([
    "activity_recent",
    "claim_acquire",
    "claim_release",
    "claim_renew",
    "claims_list",
    "decision_record",
    "decisions_list",
    "memory_remember",
    "memory_search",
    "project_context_get",
    "project_context_update",
  ]);
  expect(
    result.tools.every((tool) => tool.inputSchema && tool.outputSchema),
  ).toBe(true);
});

test("memory tools and HTTP read and write the same project state", async () => {
  const fromMcp = c.memorySchema.parse(
    await call("memory_remember", {
      ...actor,
      type: "fact",
      content: "Shared pagination knowledge",
      metadata: { files: ["src/search.ts"] },
    }),
  );
  expect((await f.client().search({ query: "pagination" })).items).toEqual([
    fromMcp,
  ]);
  const fromHttp = await f
    .client()
    .remember({ type: "note", content: "Shared billing knowledge" });
  expect(
    c.memoriesResult.parse(
      await call("memory_search", {
        projectId: actor.projectId,
        query: "billing",
      }),
    ).items,
  ).toEqual([fromHttp]);
  expect(
    c.memoriesResult.parse(
      await call("memory_search", { projectId: "other", query: "knowledge" }),
    ).items,
  ).toEqual([]);
});

test("all four claim actions and claim listing share HTTP concurrency semantics", async () => {
  const granted = c.claimGranted.parse(
    await call("claim_acquire", { ...actor, resource: "feature:search" }),
  );
  expect((await f.client().listClaims()).items).toEqual([granted.claim]);
  await expect(
    f.client().claim({ resource: "feature:search" }),
  ).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
  const http = await f.client().claim({ resource: "feature:billing" });
  const conflict = await mcp.callTool({
    name: "claim_acquire",
    arguments: { ...actor, resource: http.resource },
  });
  expect(conflict.isError).toBe(true);
  expect(errorResponse.parse(conflict.structuredContent).error.code).toBe(
    "CLAIM_CONFLICT",
  );
  expect(
    c.claimsResult.parse(
      await call("claims_list", { projectId: actor.projectId }),
    ),
  ).toEqual(await f.client().listClaims());
  f.advance(1000);
  const renewed = c.claimSchema.parse(
    await call("claim_renew", {
      claimId: granted.claim.id,
      agentId: actor.agentId,
    }),
  );
  expect(
    (await f.client().listClaims({ resource: "feature:search" })).items,
  ).toEqual([renewed]);
  const renewedHttp = await f.client().renewClaim(http.id);
  expect(
    c.claimsResult.parse(
      await call("claims_list", {
        projectId: actor.projectId,
        resource: http.resource,
      }),
    ).items,
  ).toEqual([renewedHttp]);
  const release = await call("claim_release", {
    claimId: granted.claim.id,
    agentId: actor.agentId,
  });
  expect(c.claimReleased.parse(release).released).toBe(true);
  await f.client().releaseClaim(http.id);
  expect(
    c.claimsResult.parse(
      await call("claims_list", { projectId: actor.projectId }),
    ).items,
  ).toEqual([]);
});

test("context tools use the same optimistic versioning and expose conflicts", async () => {
  const created = c.contextSchema.parse(
    await call("project_context_update", {
      ...actor,
      expectedVersion: 0,
      content: "Initial context",
    }),
  );
  expect(await f.client().getContext()).toEqual(created);
  const updated = await f.client().updateContext({
    expectedVersion: created.version,
    content: "HTTP update",
  });
  expect(
    c.contextSchema.parse(
      await call("project_context_get", { projectId: actor.projectId }),
    ),
  ).toEqual(updated);
  const conflict = await mcp.callTool({
    name: "project_context_update",
    arguments: {
      ...actor,
      expectedVersion: created.version,
      content: "Stale update",
    },
  });
  expect(conflict.isError).toBe(true);
  expect(errorResponse.parse(conflict.structuredContent).error).toMatchObject({
    code: "CONTEXT_VERSION_CONFLICT",
    details: { actualVersion: 2, expectedVersion: 1 },
  });
});

test("decision tools and activity tool expose identical domain records", async () => {
  const old = c.decisionSchema.parse(
    await call("decision_record", {
      ...actor,
      subject: "database",
      decision: "Use SQLite",
    }),
  );
  expect((await f.client().listDecisions()).items).toEqual([old]);
  const next = await f.client().recordDecision({
    subject: "database",
    decision: "Keep SQLite with FTS5",
    supersedesId: old.id,
  });
  expect(
    c.decisionsResult.parse(
      await call("decisions_list", {
        projectId: actor.projectId,
        status: "active",
      }),
    ).items,
  ).toEqual([next]);
  expect(
    c.activityResult.parse(
      await call("activity_recent", { projectId: actor.projectId }),
    ),
  ).toEqual(await f.client().recentActivity());
  expect(
    c.activityResult.parse(
      await call("activity_recent", {
        projectId: actor.projectId,
        agentId: "agent-a",
        type: "decision.superseded",
        since: f.time,
      }),
    ),
  ).toEqual(
    await f.client().recentActivity({
      agentId: "agent-a",
      type: "decision.superseded",
      since: f.time,
    }),
  );
});

test("MCP resource templates are views over the same four services", async () => {
  await f
    .client()
    .updateContext({ expectedVersion: 0, content: "Canonical context" });
  await f.client().claim({ resource: "feature:resource-view" });
  await f
    .client()
    .recordDecision({ subject: "MCP", decision: "Use resource views" });
  expect((await mcp.listResourceTemplates()).resourceTemplates).toHaveLength(4);
  const expected = {
    context: await f.client().getContext(),
    activity: await f.client().recentActivity(),
    decisions: await f.client().listDecisions(),
    claims: await f.client().listClaims(),
  };
  for (const [name, data] of Object.entries(expected)) {
    const result = await mcp.readResource({
      uri: `memory://projects/test-project/${name}`,
    });
    const first = result.contents[0];
    if (!first || !("text" in first)) throw new Error("Expected text resource");
    const actual: unknown = JSON.parse(first.text);
    expect(actual).toEqual(data);
  }
});
