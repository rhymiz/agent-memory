import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AppError, type ErrorCode } from "../src/domain/errors";
import { openDatabase } from "../src/db/database";
import { createApplication } from "../src/application";
import { readConfig } from "../src/config";
import { readRuntimeDirectory } from "../src/embeddings/assets";
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});
const actor = { projectId: "test-project", agentId: "agent-a" };
const claimInput = { ...actor, resource: "feature:search" };
function expectCode(action: () => unknown, code: ErrorCode): void {
  try {
    action();
    throw new Error("Expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    if (error instanceof AppError) expect(error.code).toBe(code);
  }
}

describe("memory and persistence", () => {
  test("inserts searchable memory with parsed metadata and project isolation", async () => {
    const memory = await f.app.memories.remember({
      ...actor,
      type: "observation",
      content: "Search pagination uses cursors",
      importance: 0.7,
      metadata: { files: ["src/search.ts"], nested: { enabled: true } },
    });
    expect(memory.id).toMatch(/^mem_[0-9a-f-]{36}$/);
    expect(
      (
        await f.app.memories.search({
          projectId: actor.projectId,
          query: "pagination search",
        })
      ).items,
    ).toEqual([memory]);
    expect(
      (
        await f.app.memories.search({
          projectId: "another",
          query: "pagination",
        })
      ).items,
    ).toEqual([]);
  });
  test("treats query punctuation as data, with no FTS syntax errors", async () => {
    await f.app.memories.remember({
      ...actor,
      type: "fact",
      content: "Search cursors",
    });
    expect(
      (
        await f.app.memories.search({
          projectId: actor.projectId,
          query: '"search" (cursors):*',
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await f.app.memories.search({
          projectId: actor.projectId,
          query: '"(*):',
        })
      ).items,
    ).toEqual([]);
  });
  test("database enforces append-only activity", async () => {
    await f.app.memories.remember({
      ...actor,
      type: "fact",
      content: "Durable knowledge",
    });
    expect(() => f.db.exec("UPDATE activity SET message = 'Changed'")).toThrow(
      "append-only",
    );
    expect(() => f.db.exec("DELETE FROM activity")).toThrow("append-only");
  });
  test("memory and FTS survive reopening; migrations are idempotent", async () => {
    const memory = await f.client().remember({
      type: "fact",
      content: "Persistence survives daemon restart",
    });
    await f.http.stop(true);
    f.db.close(true);
    const reopened = openDatabase(f.dbPath);
    try {
      const app = createApplication(
        reopened,
        {
          defaultTtlSeconds: 300,
          maxTtlSeconds: 3600,
        },
        f.model,
      );
      expect(
        (
          await app.memories.search({
            projectId: actor.projectId,
            query: "restart",
          })
        ).items,
      ).toEqual([memory]);
      expect(
        reopened.query("SELECT * FROM schema_migrations").all(),
      ).toHaveLength(3);
    } finally {
      reopened.close(true);
    }
  });
  test("memory, FTS and activity roll back together", async () => {
    f.db.exec(
      "CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'event failure'); END",
    );
    await expect(
      f.app.memories.remember({
        ...actor,
        type: "fact",
        content: "Atomic memory",
      }),
    ).rejects.toThrow("event failure");
    expect(
      (
        await f.app.memories.search({
          projectId: actor.projectId,
          query: "Atomic",
        })
      ).items,
    ).toEqual([]);
    expect(f.db.query("SELECT * FROM memories").all()).toHaveLength(0);
  });
});

describe("claims", () => {
  test("acquires and denies duplicate acquisition, including by the same owner", () => {
    const { claim } = f.app.claims.acquire(claimInput);
    expect(claim.expiresAt).toBe(f.time + 300_000);
    expectCode(
      () => f.app.claims.acquire({ ...claimInput, agentId: "agent-b" }),
      "CLAIM_CONFLICT",
    );
    expectCode(() => f.app.claims.acquire(claimInput), "CLAIM_CONFLICT");
    expect(f.app.claims.list(actor).items).toEqual([claim]);
  });
  test("owner releases and another agent acquires; non-owner cannot release or renew", () => {
    const { claim } = f.app.claims.acquire(claimInput);
    expectCode(
      () => f.app.claims.release({ claimId: claim.id, agentId: "agent-b" }),
      "CLAIM_NOT_OWNER",
    );
    expectCode(
      () => f.app.claims.renew({ claimId: claim.id, agentId: "agent-b" }),
      "CLAIM_NOT_OWNER",
    );
    f.app.claims.release({ claimId: claim.id, agentId: actor.agentId });
    expect(
      f.app.claims.acquire({ ...claimInput, agentId: "agent-b" }).claim.agentId,
    ).toBe("agent-b");
    expectCode(
      () => f.app.claims.release({ claimId: claim.id, agentId: actor.agentId }),
      "CLAIM_NOT_FOUND",
    );
  });
  test("expires at the exact boundary and cannot be renewed or released", () => {
    const { claim } = f.app.claims.acquire({ ...claimInput, ttlSeconds: 1 });
    f.advance(999);
    expect(f.app.claims.list(actor).items).toHaveLength(1);
    f.advance(1);
    expectCode(
      () => f.app.claims.renew({ claimId: claim.id, agentId: actor.agentId }),
      "CLAIM_EXPIRED",
    );
    expectCode(
      () => f.app.claims.release({ claimId: claim.id, agentId: actor.agentId }),
      "CLAIM_EXPIRED",
    );
    expect(f.app.claims.list(actor).items).toEqual([]);
    expect(
      f.app.activity
        .recent(actor)
        .items.filter((event) => event.type === "claim.expired"),
    ).toHaveLength(1);
    expect(
      f.app.activity
        .recent(actor)
        .items.filter((event) => event.type === "claim.expired"),
    ).toHaveLength(1);
  });
  test("lazily reclaims expired resources without prior listing", () => {
    const first = f.app.claims.acquire({ ...claimInput, ttlSeconds: 1 }).claim;
    f.advance(1000);
    const next = f.app.claims.acquire({
      ...claimInput,
      agentId: "agent-b",
    }).claim;
    expect(next.id).not.toBe(first.id);
    expect(
      f.app.activity
        .recent({ projectId: actor.projectId })
        .items.map((event) => event.type),
    ).toEqual(["claim.acquired", "claim.expired", "claim.acquired"]);
  });
  test("renewal extends from now without shortening a lease", () => {
    const { claim } = f.app.claims.acquire(claimInput);
    f.advance(100_000);
    const renewed = f.app.claims.renew({
      claimId: claim.id,
      agentId: actor.agentId,
    });
    expect(renewed.expiresAt).toBe(f.time + 300_000);
    expect(
      f.app.claims.renew({
        claimId: claim.id,
        agentId: actor.agentId,
        ttlSeconds: 1,
      }).expiresAt,
    ).toBe(renewed.expiresAt);
  });
  test("canonical paths conflict and reject absolute or escaping paths", () => {
    const claim = f.app.claims.acquire({
      ...actor,
      resource: " FILE:./src\\services//../search.ts ",
    }).claim;
    expect(claim.resource).toBe("file:src/search.ts");
    expectCode(
      () => f.app.claims.acquire({ ...actor, resource: "file:src/search.ts" }),
      "CLAIM_CONFLICT",
    );
    expect(
      f.app.claims.list({
        projectId: actor.projectId,
        resource: "file:./src/search.ts",
      }).items,
    ).toEqual([claim]);
    for (const resource of [
      "file:/etc/passwd",
      "file:../escape",
      "file:C:\\file",
      "file:./",
      "feature:",
      "unscoped",
      "feature:x\ny",
    ]) {
      expectCode(
        () => f.app.claims.acquire({ ...actor, resource }),
        "INVALID_REQUEST",
      );
    }
  });
  test("exact-resource claims are project isolated and non-hierarchical", () => {
    f.app.claims.acquire({ ...actor, resource: "directory:src" });
    f.app.claims.acquire({ ...actor, resource: "file:src/index.ts" });
    f.app.claims.acquire({
      ...actor,
      projectId: "other",
      resource: "directory:src",
    });
    expect(f.app.claims.list(actor).items).toHaveLength(2);
  });
  test("rejects invalid TTLs and enforces the configured maximum", () => {
    for (const ttlSeconds of [0, -1, 0.5, 3601, NaN, Infinity])
      expectCode(
        () => f.app.claims.acquire({ ...claimInput, ttlSeconds }),
        "INVALID_REQUEST",
      );
  });
  test("concurrent HTTP acquisitions have exactly one winner", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        f.client(`agent-${index}`).claim({ resource: claimInput.resource }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(19);
    expect(
      f.app.activity.recent({ projectId: actor.projectId }).items,
    ).toHaveLength(1);
  });
});

describe("canonical context", () => {
  test("initializes only at zero, increments versions, and rejects stale writes", () => {
    expectCode(() => f.app.context.get(actor), "PROJECT_NOT_FOUND");
    expectCode(
      () =>
        f.app.context.update({
          ...actor,
          expectedVersion: 1,
          content: "Wrong initial version",
        }),
      "CONTEXT_VERSION_CONFLICT",
    );
    const initial = f.app.context.update({
      ...actor,
      expectedVersion: 0,
      content: "Architecture",
    });
    expect(initial.version).toBe(1);
    const next = f.app.context.update({
      ...actor,
      expectedVersion: 1,
      content: "Updated architecture",
    });
    expect(next.version).toBe(2);
    expectCode(
      () =>
        f.app.context.update({
          ...actor,
          agentId: "agent-b",
          expectedVersion: 1,
          content: "Stale update",
        }),
      "CONTEXT_VERSION_CONFLICT",
    );
    expect(f.app.context.get(actor)).toEqual(next);
    expect(f.app.activity.recent(actor).items).toHaveLength(2);
  });
  test("concurrent creation and updates each have one winner", async () => {
    for (const expectedVersion of [0, 1]) {
      const results = await Promise.allSettled(
        [f.client("agent-a"), f.client("agent-b")].map((client) =>
          client.updateContext({
            expectedVersion,
            content: `Version ${expectedVersion + 1}`,
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
    }
    expect(f.app.context.get(actor).version).toBe(2);
  });
});

describe("decisions", () => {
  test("records and supersedes with provenance; active listing excludes the old decision", () => {
    const old = f.app.decisions.record({
      ...actor,
      subject: "database",
      decision: "Use Prisma",
    });
    const next = f.app.decisions.record({
      ...actor,
      subject: "database",
      decision: "Use Kysely",
      supersedesId: old.id,
    });
    expect(next.supersedesId).toBe(old.id);
    expect(
      f.app.decisions.list({ projectId: actor.projectId, status: "active" })
        .items,
    ).toEqual([next]);
    expect(
      f.app.decisions.list({ projectId: actor.projectId, status: "superseded" })
        .items[0]?.id,
    ).toBe(old.id);
    expectCode(
      () =>
        f.app.decisions.record({
          ...actor,
          subject: "database",
          decision: "Fork",
          supersedesId: old.id,
        }),
      "DECISION_CONFLICT",
    );
  });
  test("rejects missing and cross-project predecessors", () => {
    const old = f.app.decisions.record({
      ...actor,
      subject: "database",
      decision: "Use SQLite",
    });
    for (const supersedesId of [old.id, "dec_missing"]) {
      expectCode(
        () =>
          f.app.decisions.record({
            ...actor,
            projectId: "other",
            subject: "database",
            decision: "Use anything",
            supersedesId,
          }),
        "DECISION_NOT_FOUND",
      );
    }
  });
  test("a failed decision event rolls back supersession and the new decision", () => {
    const old = f.app.decisions.record({
      ...actor,
      subject: "database",
      decision: "Use SQLite",
    });
    f.db.exec(
      "CREATE TRIGGER fail_creation BEFORE INSERT ON activity WHEN NEW.type = 'decision.created' BEGIN SELECT RAISE(ABORT, 'event failure'); END",
    );
    expect(() =>
      f.app.decisions.record({
        ...actor,
        subject: "database",
        decision: "Change",
        supersedesId: old.id,
      }),
    ).toThrow("event failure");
    expect(
      f.app.decisions.list({ projectId: actor.projectId, status: "active" })
        .items,
    ).toEqual([old]);
    expect(f.app.activity.recent(actor).items).toHaveLength(1);
  });
});

describe("activity and configuration", () => {
  test("events are newest first with deterministic insertion order for equal timestamps", async () => {
    await f.app.memories.remember({
      ...actor,
      type: "fact",
      content: "Knowledge",
    });
    f.app.claims.acquire(claimInput);
    f.app.context.update({ ...actor, expectedVersion: 0, content: "Context" });
    await f.app.memories.remember({
      ...actor,
      projectId: "another",
      type: "fact",
      content: "Other",
    });
    expect(
      f.app.activity.recent(actor).items.map((event) => event.type),
    ).toEqual(["context.updated", "claim.acquired", "memory.created"]);
    expect(
      f.app.activity.recent({
        ...actor,
        type: "claim.acquired",
        since: f.time,
        limit: 1,
      }).items,
    ).toHaveLength(1);
    expect(
      f.app.activity.recent({ ...actor, since: f.time + 1 }).items,
    ).toEqual([]);
    expect(
      f.app.activity.recent({ ...actor, agentId: "someone-else" }).items,
    ).toEqual([]);
  });
  test("configuration defaults are local and invalid policies fail at startup", () => {
    expect(readConfig({}).host).toBe("127.0.0.1");
    expect(readConfig({}).dbPath).toEndWith("/.agent-memory/memory.sqlite");
    expect(readRuntimeDirectory({})).toEndWith("/.agent-memory/runtime");
    expect(
      readRuntimeDirectory({
        AGENT_MEMORY_RUNTIME_DIR: "~/.agent-memory/runtime",
      }),
    ).toBe(readRuntimeDirectory({}));
    expect(() =>
      readRuntimeDirectory({ AGENT_MEMORY_RUNTIME_DIR: " " }),
    ).toThrow();
    expect(() => readConfig({ AGENT_MEMORY_HOST: "0.0.0.0" })).toThrow();
    expect(() =>
      readConfig({
        AGENT_MEMORY_DEFAULT_CLAIM_TTL: "100",
        AGENT_MEMORY_MAX_CLAIM_TTL: "10",
      }),
    ).toThrow();
    expect(() => readConfig({ AGENT_MEMORY_PORT: "garbage" })).toThrow();
  });
});
