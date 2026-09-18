import { expect, test } from "bun:test";
import {
  evaluationCase,
  evaluateCase,
} from "../scripts/lib/retrieval-evaluation";
import { fixture } from "./helpers";

test("relevance evaluation measures answers and stale hits independently of record type", async () => {
  const f = fixture();
  try {
    const client = f.client();
    const useful = await client.remember({
      type: "result",
      content: "pagination cursor",
    });
    f.advance(1);
    const stale = await client.remember({
      type: "fact",
      content: "pagination cursor",
    });
    const decision = await client.recordDecision({
      subject: "Pagination",
      decision: "Use opaque cursors",
    });
    const input = evaluationCase.parse({
      name: "cursor contract",
      projectId: "test-project",
      query: "pagination cursor",
      limit: 2,
      relevantMemoryIds: [useful.id],
      staleMemoryIds: [stale.id],
      relevantDecisionIds: [decision.id],
      decisionQuery: "Pagination",
    });
    const result = await evaluateCase(input, client);
    expect(result.memories).toEqual({
      precisionAtK: 0.5,
      recallAtK: 1,
      reciprocalRank: 0.5,
      missingIds: [],
    });
    expect(result.decisions).toEqual({
      precisionAtK: 0.5,
      recallAtK: 1,
      reciprocalRank: 1,
      missingIds: [],
    });
    expect(result.staleMemoryIds).toEqual([stale.id]);
    const filtered = await evaluateCase(
      { ...input, memoryFilter: { types: ["fact"] } },
      client,
    );
    expect(filtered.memories).toMatchObject({
      precisionAtK: 0,
      recallAtK: 0,
      missingIds: [useful.id],
    });
    expect(filtered.staleMemoryIds).toEqual([stale.id]);
    expect((await client.recentActivity()).items).toHaveLength(3);
  } finally {
    await f.close();
  }
});

test("evaluation requires consistent explicit judgments", () => {
  const base = { name: "contract", projectId: "p", query: "cursor" };
  expect(evaluationCase.safeParse(base).success).toBe(false);
  expect(
    evaluationCase.safeParse({
      ...base,
      relevantMemoryIds: ["mem_a"],
      staleMemoryIds: ["mem_a"],
    }).success,
  ).toBe(false);
  expect(
    evaluationCase.safeParse({ ...base, relevantMemoryIds: ["mem_a", "mem_a"] })
      .success,
  ).toBe(false);
});
