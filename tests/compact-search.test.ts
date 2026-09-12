import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { compactSearchResult } from "../src/domain/contracts";
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});

test("compact search preserves full records and returns query excerpts, versions and bounded JSON", async () => {
  const memory = await f.client().remember({
    type: "constraint",
    content:
      "Unrelated introduction. ".repeat(3000) +
      '\n\nZEPHYR_42 requires "東京😀" and newlines.\n'.repeat(100),
    metadata: { large: "private metadata ".repeat(5000) },
  });
  const full = await f.client().search({ query: "ZEPHYR_42" });
  expect(full.items).toEqual([memory]);
  for (const maxBytes of [1024, 1500, 12_000, 64_000]) {
    const compact = await f
      .client()
      .searchCompact({ query: "ZEPHYR_42", maxBytes });
    expect(
      new TextEncoder().encode(JSON.stringify(compact)).length,
    ).toBeLessThanOrEqual(maxBytes);
    expect(compact.hasMore).toBe(false);
    expect(compact.items).toHaveLength(1);
    const hit = compact.items[0]!;
    expect(hit).toMatchObject({
      id: memory.id,
      version: memory.version,
      type: "constraint",
      updatedAt: memory.updatedAt,
    });
    expect(hit.excerpt.text).toContain("ZEPHYR_42");
    expect(hit.excerpt.text.isWellFormed()).toBe(true);
    expect(hit.excerpt.truncated).toBe(true);
    expect(memory.content).toContain(hit.excerpt.text);
    expect(hit).not.toHaveProperty("metadata");
  }
  expect(await f.client().getMemory(memory.id)).toEqual(memory);
});

test("budget and count omissions preserve rank and are distinct from excerpt truncation", async () => {
  for (let index = 0; index < 12; index++) {
    await f.client().remember({
      type: "fact",
      content: `ZEPHYR_42 record ${index}. ` + '😀\n\t"'.repeat(1000),
    });
    f.advance(1);
  }
  const full = await f.client().search({ query: "ZEPHYR_42", limit: 20 });
  for (const maxBytes of [1024, 1500, 12_000]) {
    const compact = await f
      .client()
      .searchCompact({ query: "ZEPHYR_42", limit: 3, maxBytes });
    expect(
      new TextEncoder().encode(JSON.stringify(compact)).length,
    ).toBeLessThanOrEqual(maxBytes);
    expect(compact.hasMore).toBe(true);
    expect(compact.items.length).toBeGreaterThan(0);
    expect(compact.items.map((item) => item.id)).toEqual(
      full.items.slice(0, compact.items.length).map((item) => item.id),
    );
    for (const hit of compact.items)
      expect(hit.excerpt.text.isWellFormed()).toBe(true);
  }
  const short = await f
    .client()
    .remember({ type: "fact", content: "UNIQUE_SHORT" });
  expect(await f.client().searchCompact({ query: "UNIQUE_SHORT" })).toEqual({
    items: [
      {
        id: short.id,
        type: short.type,
        version: 1,
        updatedAt: short.updatedAt,
        excerpt: { text: short.content, truncated: false },
      },
    ],
    hasMore: false,
  });
  expect(await f.client().searchCompact({ query: "!!!" })).toEqual({
    items: [],
    hasMore: false,
  });
});

test("compact MCP text matches structured output; corrections, deletions and project scope stay current", async () => {
  const memory = await f
    .client()
    .remember({ type: "fact", content: "ZEPHYR_42 original" });
  const mcp = new Client(
    { name: "compact-search-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
    );
    const result = await mcp.callTool({
      name: "memory_search_compact",
      arguments: { projectId: "test-project", query: "ZEPHYR_42" },
    });
    expect(result.isError).not.toBe(true);
    const compact = compactSearchResult.parse(result.structuredContent);
    expect(compact).toEqual(
      await f.client().searchCompact({ query: "ZEPHYR_42" }),
    );
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(compact) },
    ]);
    expect(
      await f
        .client("other", "other-project")
        .searchCompact({ query: "ZEPHYR_42" }),
    ).toEqual({ items: [], hasMore: false });
    await f.client().updateMemory(memory.id, {
      expectedVersion: memory.version,
      content: "OMEGA_99 correction",
    });
    expect(
      (await f.client().searchCompact({ query: "ZEPHYR_42" })).items,
    ).toEqual([]);
    const current = (await f.client().searchCompact({ query: "OMEGA_99" }))
      .items[0]!;
    expect(current.version).toBe(2);
    await f.client().deleteMemory(current.id, current.version);
    expect(
      (await f.client().searchCompact({ query: "OMEGA_99" })).items,
    ).toEqual([]);
    for (const invalid of [
      { maxBytes: 1023 },
      { maxBytes: 64_001 },
      { maxBytes: "1024" },
      { limit: 51 },
      { unknown: true },
    ]) {
      expect(
        (
          await mcp.callTool({
            name: "memory_search_compact",
            arguments: { projectId: "test-project", query: "test", ...invalid },
          })
        ).isError,
      ).toBe(true);
    }
    for (const query of [
      "maxBytes=1023",
      "maxBytes=64001",
      "maxBytes=NaN",
      "maxBytes=1024&maxBytes=2048",
      "limit=51",
      "unknown=true",
    ]) {
      expect(
        (
          await fetch(
            new URL(
              `/memories/search/compact?projectId=test-project&q=test&${query}`,
              f.baseUrl,
            ),
          )
        ).status,
      ).toBe(400);
    }
  } finally {
    await mcp.close();
  }
});
