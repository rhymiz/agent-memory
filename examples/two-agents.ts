import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MemoryClient, MemoryClientError } from "../src/client/memory-client";
import { startDaemon } from "./daemon-process";

async function expectConflict(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) =>
      error instanceof MemoryClientError && error.code === code,
  );
}

async function runAgent(role: "a" | "b"): Promise<void> {
  const baseUrl = z.url().parse(process.env.DEMO_BASE_URL);
  const client = new MemoryClient({
    baseUrl,
    projectId: "two-agent-demo",
    agentId: `agent-${role}`,
  });
  assert.equal((await client.health()).status, "ok");
  if (role === "a") {
    const claim = await client.claim({
      resource: "feature:talent-search",
      intent: "Implement cursor pagination",
    });
    await client.remember({
      type: "observation",
      content: "Talent search currently uses offset pagination.",
    });
    for (const expectedVersion of [0, 1, 2])
      await client.updateContext({
        expectedVersion,
        content: `Canonical context version ${expectedVersion + 1}`,
      });
    const context = await client.getContext();
    const advance = once(process, "message");
    process.send?.("ready");
    await advance;
    assert.equal(
      (
        await client.updateContext({
          expectedVersion: context.version,
          content: "Canonical context version 4",
        })
      ).version,
      4,
    );
    await client.releaseClaim(claim.id);
    process.send?.("released");
  } else {
    await once(process, "message");
    const memories = await client.search({ query: "talent search pagination" });
    assert.equal(memories.items[0]?.agentId, "agent-a");
    await expectConflict(
      () => client.claim({ resource: "feature:talent-search" }),
      "CLAIM_CONFLICT",
    );
    assert.ok(
      (await client.recentActivity()).items.some(
        (event) => event.agentId === "agent-a",
      ),
    );
    const context = await client.getContext();
    assert.equal(context.version, 3);
    const finish = once(process, "message");
    process.send?.("observed");
    await finish;
    const claim = await client.claim({ resource: "feature:talent-search" });
    await expectConflict(
      () =>
        client.updateContext({
          expectedVersion: context.version,
          content: "Stale context",
        }),
      "CONTEXT_VERSION_CONFLICT",
    );
    assert.equal((await client.getContext()).version, 4);
    await client.releaseClaim(claim.id);
    process.send?.("done");
  }
  process.disconnect?.();
}

async function runDemo(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "agent-memory-demo-"));
  const daemon = await startDaemon(join(directory, "memory.sqlite"));
  const ready = Promise.withResolvers<void>();
  const observed = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  const events = z.enum(["ready", "observed", "released", "done"]);
  const launch = (role: "a" | "b") =>
    Bun.spawn([process.execPath, import.meta.path, "--agent", role], {
      env: { ...process.env, DEMO_BASE_URL: daemon.baseUrl },
      stdout: "inherit",
      stderr: "inherit",
      timeout: 15_000,
      ipc(message: unknown) {
        switch (events.parse(message)) {
          case "ready":
            ready.resolve();
            break;
          case "observed":
            observed.resolve();
            break;
          case "released":
            released.resolve();
            break;
          case "done":
            done.resolve();
            break;
        }
      },
    });
  const a = launch("a");
  const b = launch("b");
  const failed = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => failed.reject(new Error("Two-agent demo timed out")),
    15_000,
  );
  for (const child of [a, b])
    void child.exited.then((code) => {
      if (code !== 0) failed.reject(new Error(`Agent process failed: ${code}`));
    });
  try {
    await Promise.race([ready.promise, failed.promise]);
    b.send("inspect");
    await Promise.race([observed.promise, failed.promise]);
    console.log(
      "Agent B found A's observation and activity, received CLAIM_CONFLICT, and read context version 3.",
    );
    a.send("advance");
    await Promise.race([released.promise, failed.promise]);
    b.send("finish");
    await Promise.race([done.promise, failed.promise]);
    assert.deepEqual(await Promise.all([a.exited, b.exited]), [0, 0]);
    console.log(
      "Agent A released its claim and updated context to version 4. Agent B acquired the resource and received CONTEXT_VERSION_CONFLICT for its stale update.",
    );
    console.log(
      "PASS: two independent agent processes coordinated through one daemon.",
    );
  } finally {
    clearTimeout(timer);
    for (const child of [a, b])
      if (child.exitCode === null) child.kill("SIGKILL");
    await Promise.all([a.exited, b.exited]);
    await daemon.stop();
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--agent")
  await runAgent(z.enum(["a", "b"]).parse(process.argv[3]));
else await runDemo();
