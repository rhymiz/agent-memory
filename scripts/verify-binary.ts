import { strict as assert } from "node:assert";
import {
  copyFile,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { startDaemon } from "../examples/daemon-process";
import { MemoryClient } from "../src/client/memory-client";
import {
  claimsRenewed,
  compactSearchResult,
  memoriesResult,
  projectBriefing,
} from "../src/domain/contracts";

// scripts/verify-binary.sh isolates the Linux client and daemon's network.
// Each daemon also gets a filesystem sandbox. No inference/network mocks are used.
if (process.platform !== "darwin" && process.platform !== "linux")
  throw new Error("This offline packaging check requires macOS or Linux.");
const root = await realpath(resolve(import.meta.dir, ".."));
const directory = await mkdtemp(join(tmpdir(), "agent-memory-offline-"));
const binary = join(directory, "memd");
await copyFile(join(root, "dist/memd"), binary);
const profile = `(version 1)(allow default)(deny network*)
  (allow network-inbound (local ip "localhost:*"))
  (allow network-outbound (remote ip "localhost:*"))
  (deny file-read* (subpath ${JSON.stringify(root)}))`;
const sandbox =
  process.platform === "darwin"
    ? ["/usr/bin/sandbox-exec", "-p", profile]
    : [
        "bwrap",
        "--die-with-parent",
        "--bind",
        "/",
        "/",
        "--dev-bind",
        "/dev",
        "/dev",
        "--proc",
        "/proc",
        "--tmpfs",
        root,
        "--",
      ];
const options = {
  command: [...sandbox, binary],
  env: {
    AGENT_MEMORY_RUNTIME_DIR: join(directory, "runtime"),
    PATH: "/usr/bin:/bin",
  },
  cwd: directory,
};
const dbPath = join(directory, "memory.sqlite");
let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
let mcp: Client | undefined;
try {
  const sourceProbe = Bun.spawnSync(
    [...sandbox, "/bin/cat", join(root, "package.json")],
    { cwd: directory },
  );
  assert.notEqual(sourceProbe.exitCode, 0, "Sandbox must deny source access");
  const networkProbe = Bun.spawnSync(
    [
      ...sandbox,
      "/usr/bin/curl",
      "--noproxy",
      "*",
      "--connect-timeout",
      "2",
      "http://1.1.1.1",
    ],
    { cwd: directory },
  );
  assert.notEqual(
    networkProbe.exitCode,
    0,
    "Sandbox must deny external connections",
  );
  daemon = await startDaemon(dbPath, options);
  const client = new MemoryClient({
    baseUrl: daemon.baseUrl,
    projectId: "offline",
    agentId: "a",
  });
  const health = await client.health();
  assert.equal(health.version, "0.6.0");
  const memory = await client.remember({
    type: "fact",
    content:
      "Public organization profiles must remain accessible without authentication.",
  });
  const query = "Can visitors view company pages without signing in?";
  assert.deepEqual((await client.search({ query, limit: 1 })).items, [memory]);
  mcp = new Client(
    { name: "offline-binary-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", daemon.baseUrl)),
  );
  assert.equal((await mcp.listTools()).tools.length, 22);
  assert.deepEqual((await client.listProjects()).items, [
    { projectId: "offline" },
  ]);
  assert.deepEqual((await client.listMemories({ types: ["fact"] })).items, [
    memory,
  ]);
  assert.equal((await client.corpusStats()).embeddings.memories, 1);
  assert.deepEqual(
    (await client.search({ query, types: ["result"] })).items,
    [],
  );
  assert.deepEqual((await client.search({ query, types: ["fact"] })).items, [
    memory,
  ]);
  const decision = await client.recordDecision({
    subject: "Public profiles",
    decision: "Permit anonymous visitors",
  });
  assert.deepEqual((await client.listDecisions({ query: "anonymous" })).items, [
    decision,
  ]);
  assert.equal(
    (await client.getBriefing({ query: "anonymous" })).decisions?.items[0]?.id,
    decision.id,
  );
  const batch = await client.acquireClaims({
    resources: ["file:a.ts", "file:generated/b.ts"],
  });
  assert.equal(batch.claims.length, 2);
  assert.equal(batch.advisories[0]?.kind, "generated-resources");
  await client.releaseClaims(batch.claims.map((claim) => claim.id));
  const acquired = await client.acquireClaim({
    resource: "feature:default-lease",
  });
  const defaultClaim = acquired.claim;
  assert.equal(defaultClaim.expiresAt - defaultClaim.createdAt, 1_800_000);
  assert.equal(acquired.schedule.renewAfter - defaultClaim.createdAt, 900_000);
  assert.equal(acquired.schedule.expiresAt, defaultClaim.expiresAt);
  const compactResponse = await mcp.callTool({
    name: "memory_search_compact",
    arguments: { projectId: "offline", query, maxBytes: 1024 },
  });
  const compact = compactSearchResult.parse(compactResponse.structuredContent);
  assert.deepEqual(
    compact,
    await client.searchCompact({ query, maxBytes: 1024 }),
  );
  assert.equal(compact.items[0]?.id, memory.id);
  assert.ok(new TextEncoder().encode(JSON.stringify(compact)).length <= 1024);
  assert.deepEqual(compactResponse.content, [
    { type: "text", text: JSON.stringify(compactResponse.structuredContent) },
  ]);
  const briefingResponse = await mcp.callTool({
    name: "project_briefing",
    arguments: { projectId: "offline", query, maxBytes: 4096 },
  });
  const briefing = projectBriefing.parse(briefingResponse.structuredContent);
  assert.deepEqual(
    briefing,
    await client.getBriefing({ query, maxBytes: 4096 }),
  );
  assert.equal(briefing.memories?.items[0]?.id, memory.id);
  assert.equal(briefing.claims?.items[0]?.id, defaultClaim.id);
  assert.deepEqual(briefing.context, { items: [], hasMore: false });
  assert.ok(new TextEncoder().encode(JSON.stringify(briefing)).length <= 4096);
  assert.deepEqual(briefingResponse.content, [
    { type: "text", text: JSON.stringify(briefingResponse.structuredContent) },
  ]);
  const shortClaim = await client.claim({
    resource: "feature:short-lease",
    ttlSeconds: 300,
  });
  const claimIds = [defaultClaim.id, shortClaim.id];
  const renewal = claimsRenewed.parse(
    (
      await mcp.callTool({
        name: "claims_renew",
        arguments: { projectId: "offline", agentId: "a", claimIds },
      })
    ).structuredContent,
  );
  assert.equal(renewal.claimCount, 2);
  assert.ok(renewal.renewedCount > 0);
  assert.equal(renewal.expiresAt - renewal.renewAfter, 900_000);
  assert.deepEqual(await client.renewClaims(claimIds), {
    ...renewal,
    renewedCount: 0,
  });
  for (const claimId of claimIds) await client.releaseClaim(claimId);
  assert.deepEqual(
    memoriesResult.parse(
      (
        await mcp.callTool({
          name: "memory_search",
          arguments: { projectId: "offline", query, limit: 1 },
        })
      ).structuredContent,
    ).items,
    [memory],
  );
  await mcp.close();
  mcp = undefined;
  await daemon.stop();
  daemon = undefined;
  // Damage one cached asset. Restart must repair it from the executable without a download.
  const cacheNames = await readdir(join(directory, "runtime"));
  assert.equal(cacheNames.length, 1);
  await writeFile(
    join(directory, "runtime", cacheNames[0]!, "tokenizer_config.json"),
    "corrupted",
  );
  daemon = await startDaemon(dbPath, options);
  const restarted = new MemoryClient({
    baseUrl: daemon.baseUrl,
    projectId: "offline",
    agentId: "b",
  });
  assert.deepEqual((await restarted.search({ query })).items, [memory]);
  assert.deepEqual(
    (await restarted.listDecisions({ query: "anonymous" })).items,
    [decision],
  );
  const updated = await restarted.updateMemory(memory.id, {
    expectedVersion: 1,
    content: "Invoices are retained for seven years.",
  });
  assert.deepEqual((await restarted.search({ query })).items, []);
  assert.deepEqual(
    (
      await restarted.search({
        query: "How long should billing records be kept?",
      })
    ).items,
    [updated],
  );
  await restarted.deleteMemory(updated.id, updated.version);
  assert.deepEqual(
    (
      await restarted.search({
        query: "How long should billing records be kept?",
      })
    ).items,
    [],
  );
  console.log(
    "PASS: standalone binary, fresh cache, blocked external network/source access, HTTP/MCP full and compact semantic retrieval, filters, operator inspection, decision search, bounded briefing, batch acquisition/release/renewal, restart, cache repair, update and delete",
  );
} finally {
  await mcp?.close();
  await daemon?.stop();
  await rm(directory, { recursive: true, force: true });
}
