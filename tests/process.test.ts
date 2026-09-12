import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { z } from "zod";
import { startDaemon } from "../examples/daemon-process";
import { MemoryClient } from "../src/client/memory-client";
import { memorySchema } from "../src/domain/contracts";

test("a second daemon cannot open the database on a different port; restart preserves state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-memory-process-"));
  const dbPath = join(directory, "memory.sqlite");
  const daemon = await startDaemon(dbPath);
  try {
    const a = new MemoryClient({
      baseUrl: daemon.baseUrl,
      projectId: "persist",
      agentId: "a",
    });
    const original = await a.remember({
      type: "fact",
      content: "Durable across processes",
    });
    const memory = await a.updateMemory(original.id, {
      expectedVersion: original.version,
      content: "Durable corrected knowledge",
    });
    const removed = await a.remember({
      type: "note",
      content: "discardedtoken",
    });
    await a.deleteMemory(removed.id, removed.version);
    const contender = Bun.spawn(
      [process.execPath, `${import.meta.dir}/../src/index.ts`],
      {
        env: {
          ...process.env,
          AGENT_MEMORY_DB: dbPath,
          AGENT_MEMORY_PORT: "0",
          AGENT_MEMORY_HOST: "127.0.0.1",
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10_000,
      },
    );
    expect(await contender.exited).toBe(1);
    expect(await new Response(contender.stderr).text()).toContain(
      "database is locked",
    );
    expect(await a.health()).toMatchObject({ database: "ok" });
    await daemon.stop();
    const restarted = await startDaemon(dbPath);
    try {
      const b = new MemoryClient({
        baseUrl: restarted.baseUrl,
        projectId: "persist",
        agentId: "b",
      });
      expect((await b.search({ query: "Durable" })).items).toEqual([memory]);
      expect((await b.search({ query: "discardedtoken" })).items).toEqual([]);
      await expect(b.getMemory(removed.id)).rejects.toMatchObject({
        code: "MEMORY_NOT_FOUND",
      });
    } finally {
      await restarted.stop();
    }
  } finally {
    if (daemon.child.exitCode === null) await daemon.stop();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

test("stdio MCP and HTTP share one process; stdio diagnostics never corrupt the protocol", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-memory-stdio-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [`${import.meta.dir}/../src/index.ts`, "--stdio"],
    env: {
      AGENT_MEMORY_DB: join(directory, "memory.sqlite"),
      AGENT_MEMORY_PORT: "0",
      AGENT_MEMORY_HOST: "127.0.0.1",
    },
    stderr: "pipe",
  });
  const client = new Client(
    { name: "stdio-test-agent", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const ready = Promise.withResolvers<string>();
  const timer = setTimeout(
    () => ready.reject(new Error("Missing startup log")),
    5000,
  );
  const stderr = transport.stderr;
  if (!(stderr instanceof Readable))
    throw new Error("Expected readable piped stderr");
  const lines = createInterface({ input: stderr });
  const logSchema = z.object({
    event: z.literal("daemon.started"),
    url: z.url(),
  });
  lines.on("line", (line: string) => {
    const value: unknown = JSON.parse(line);
    const log = logSchema.safeParse(value);
    if (log.success) ready.resolve(log.data.url);
  });
  try {
    await client.connect(transport);
    expect(client.getProtocolEra()).toBe("modern");
    const baseUrl = await ready.promise;
    const result = await client.callTool({
      name: "memory_remember",
      arguments: {
        projectId: "stdio",
        agentId: "stdio-agent",
        type: "fact",
        content: "Shared stdio knowledge",
      },
    });
    const memory = memorySchema.parse(result.structuredContent);
    const http = new MemoryClient({
      baseUrl,
      projectId: "stdio",
      agentId: "http-agent",
    });
    expect((await http.search({ query: "stdio" })).items).toEqual([memory]);
    expect((await client.listTools()).tools).toHaveLength(17);
  } finally {
    clearTimeout(timer);
    await client.close();
    lines.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);

test("the runnable demo completes with two independently running HTTP agents", async () => {
  const demo = Bun.spawn(
    [process.execPath, `${import.meta.dir}/../examples/two-agents.ts`],
    { stdout: "pipe", stderr: "pipe", timeout: 20_000 },
  );
  const [code, stdout, stderr] = await Promise.all([
    demo.exited,
    new Response(demo.stdout).text(),
    new Response(demo.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain("PASS: two independent agent processes");
}, 25_000);
