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
import { memoriesResult } from "../src/domain/contracts";

// macOS supplies an OS-enforced network policy. No inference/network mocks are used.
if (process.platform !== "darwin")
  throw new Error("This offline packaging check requires macOS sandbox-exec.");
const root = await realpath(resolve(import.meta.dir, ".."));
const directory = await mkdtemp(join(tmpdir(), "agent-memory-offline-"));
const binary = join(directory, "memd");
await copyFile(join(root, "dist/memd"), binary);
const profile = `(version 1)(allow default)(deny network*)
  (allow network-inbound (local ip "localhost:*"))
  (allow network-outbound (remote ip "localhost:*"))
  (deny file-read* (subpath ${JSON.stringify(root)}))`;
const options = {
  command: ["/usr/bin/sandbox-exec", "-p", profile, binary],
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
  const networkProbe = Bun.spawnSync(
    [
      "/usr/bin/sandbox-exec",
      "-p",
      profile,
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
  assert.equal(health.version, "0.3.0");
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
    "PASS: standalone binary, fresh cache, blocked external network/source access, HTTP/MCP semantic retrieval, restart, cache repair, update and delete",
  );
} finally {
  await mcp?.close();
  await daemon?.stop();
  await rm(directory, { recursive: true, force: true });
}
