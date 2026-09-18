import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});

test("filters run before lexical and semantic candidate limits, and reach compact search and briefing", async () => {
  const client = f.client();
  const fact = await client.remember({
    type: "fact",
    content: "pagination cursor",
    importance: 0.8,
  });
  f.advance(1);
  for (let i = 0; i < 65; i++)
    await client.remember({
      type: "result",
      content: "pagination cursor",
      importance: 0.9,
    });
  expect(
    (await client.search({ query: "pagination cursor", limit: 1 })).items[0]
      ?.type,
  ).toBe("result");
  const filtered = {
    query: "pagination cursor",
    types: ["fact"] satisfies ["fact"],
    limit: 1,
  };
  expect((await client.search(filtered)).items).toEqual([fact]);
  expect(
    (await client.searchCompact(filtered)).items.map((item) => item.id),
  ).toEqual([fact.id]);
  const briefing = await client.getBriefing({
    query: filtered.query,
    memoryFilter: { types: ["fact"] },
  });
  expect(briefing.memories?.items.map((item) => item.id)).toEqual([fact.id]);
  expect((await client.listMemories({ types: ["fact"] })).items).toEqual([
    fact,
  ]);
  expect((await f.client("a", "other").search(filtered)).items).toEqual([]);
});

test("age and importance are explicit filters; corrections update eligibility and null importance is unscored", async () => {
  const client = f.client();
  const old = await client.remember({ type: "fact", content: "pagination" });
  f.advance(10);
  const since = f.time;
  const scored = await client.remember({
    type: "constraint",
    content: "pagination",
    importance: 0.7,
  });
  expect(
    (
      await client.search({
        query: "pagination",
        updatedSince: since,
        minImportance: 0.7,
      })
    ).items,
  ).toEqual([scored]);
  expect(
    (await client.search({ query: "pagination", minImportance: 0 })).items,
  ).toEqual([scored]);
  const changed = await client.updateMemory(old.id, {
    expectedVersion: 1,
    importance: 0.8,
  });
  expect(
    (await client.listMemories({ updatedSince: since, minImportance: 0.8 }))
      .items,
  ).toEqual([changed]);
  expect(
    (await client.searchCompact({ query: "pagination", minImportance: 0.9 }))
      .items,
  ).toEqual([]);
});

test("filter contracts and equivalent results cross HTTP and MCP", async () => {
  const client = f.client();
  await client.remember({
    type: "constraint",
    content: "pagination",
    importance: 0.7,
  });
  const mcp = new Client(
    { name: "filters", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", f.baseUrl)),
    );
    const filter = {
      types: ["constraint"] satisfies ["constraint"],
      minImportance: 0.7,
      updatedSince: f.time,
    };
    for (const item of [
      {
        name: "memory_search",
        args: { query: "pagination", ...filter },
        expected: await client.search({ query: "pagination", ...filter }),
      },
      {
        name: "memory_search_compact",
        args: { query: "pagination", ...filter },
        expected: await client.searchCompact({
          query: "pagination",
          ...filter,
        }),
      },
      {
        name: "project_briefing",
        args: { query: "pagination", memoryFilter: filter },
        expected: await client.getBriefing({
          query: "pagination",
          memoryFilter: filter,
        }),
      },
    ]) {
      const result = await mcp.callTool({
        name: item.name,
        arguments: { projectId: "test-project", ...item.args },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(item.expected);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(result.structuredContent) },
      ]);
    }
    for (const invalid of [
      { types: [] },
      { types: ["fact", "fact"] },
      { types: ["unknown"] },
      { updatedSince: -1 },
      { minImportance: 2 },
    ])
      expect(
        (
          await mcp.callTool({
            name: "memory_search",
            arguments: { projectId: "test-project", query: "test", ...invalid },
          })
        ).isError,
      ).toBe(true);
    for (const query of [
      "types=",
      "types=unknown",
      "types=fact,fact",
      "updatedSince=-1",
      "minImportance=NaN",
      "types=fact&types=note",
    ])
      expect(
        (
          await fetch(
            new URL(
              `/memories/search?projectId=test-project&q=test&${query}`,
              f.baseUrl,
            ),
          )
        ).status,
      ).toBe(400);
  } finally {
    await mcp.close();
  }
});
