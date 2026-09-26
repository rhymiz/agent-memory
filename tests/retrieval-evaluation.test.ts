import { expect, test } from "bun:test";
import {
  evaluationCase,
  evaluationCases,
  evaluateCase,
} from "../scripts/lib/retrieval-evaluation";
import { MemoryClient } from "../src/client/memory-client";
import type { BriefingInput } from "../src/domain/contracts";
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
    expect(result.memories).toMatchObject({
      precisionAtK: 0.5,
      recallAtK: 1,
      reciprocalRank: 0.5,
      missingIds: [],
    });
    expect(result.decisions).toMatchObject({
      precisionAtK: 0.5,
      recallAtK: 1,
      reciprocalRank: 1,
      missingIds: [],
    });
    expect(result.staleMemoryIds).toEqual([stale.id]);
    expect(result.compact.staleMemoryIds).toEqual([stale.id]);
    expect(result.briefing.staleMemoryIds).toEqual([stale.id]);
    expect(result.decisions?.precisionReturned).toBe(1);
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

test("evidence evaluation catches hidden qualifications and verifies corrected leading text", async () => {
  const f = fixture();
  try {
    const client = f.client();
    const scope = "Only applies to imported cursors.";
    const useful = await client.remember({
      type: "result",
      content: `Cursor updates are atomic. ${"Historical details. ".repeat(70)}${scope}`,
    });
    await client.remember({ type: "note", content: scope });
    const context = await client.updateContext({
      expectedVersion: 0,
      content: `${"Historical setup. ".repeat(70)}Read CONTRACT.md for cursor ownership.`,
    });
    const input = evaluationCase.parse({
      name: "cursor scope",
      projectId: "test-project",
      query: "cursor updates atomic",
      relevantMemoryIds: [useful.id],
      checks: [
        {
          name: "answer and scope",
          target: { kind: "memory", id: useful.id, version: useful.version },
          requiredText: ["Cursor updates are atomic.", scope],
        },
        {
          name: "context route",
          target: { kind: "context", version: context.version },
          requiredText: ["CONTRACT.md"],
        },
      ],
    });
    const before = await evaluateCase(input, client);
    expect(before.memories?.recallAtK).toBe(1);
    expect(before.full.checks.every((check) => check.passed)).toBe(true);
    expect(before.compact.checks[0]).toMatchObject({
      passed: false,
      truncated: true,
      missingText: [scope],
    });
    expect(
      before.briefing.checks.every((check) => check.passed === false),
    ).toBe(true);
    const corrected = await client.updateMemory(useful.id, {
      expectedVersion: useful.version,
      content: `Cursor updates are atomic. ${scope}`,
    });
    const correctedContext = await client.updateContext({
      expectedVersion: context.version,
      content: "Read CONTRACT.md for cursor ownership.",
    });
    const oldJudgments = await evaluateCase(input, client);
    expect(
      oldJudgments.full.checks.every(
        (check) => check.status === "version_changed" && check.passed === null,
      ),
    ).toBe(true);
    const rejudged = evaluationCase.parse({
      ...input,
      checks: input.checks.map((check) => ({
        ...check,
        target:
          check.target.kind === "memory"
            ? { ...check.target, version: corrected.version }
            : { ...check.target, version: correctedContext.version },
      })),
    });
    const after = await evaluateCase(rejudged, client);
    expect(after.full.checks.every((check) => check.passed)).toBe(true);
    expect(after.compact.checks.every((check) => check.passed)).toBe(true);
    expect(after.briefing.checks.every((check) => check.passed)).toBe(true);
    expect(after.briefing.bytes).toBeLessThan(before.briefing.bytes);
    expect(after.revisionChanges).toEqual([]);
  } finally {
    await f.close();
  }
});

test("forbidden text and missing context are failures, unrequested sections remain ungraded", async () => {
  const f = fixture();
  try {
    const client = f.client();
    const input = evaluationCase.parse({
      name: "context hygiene",
      projectId: "test-project",
      query: "setup",
      checks: [
        {
          name: "scoped authority",
          target: { kind: "context" },
          forbiddenText: ["Permission to deploy forever"],
        },
      ],
    });
    expect(
      (await evaluateCase(input, client)).briefing.checks[0],
    ).toMatchObject({ status: "missing", passed: false });
    await client.updateContext({
      expectedVersion: 0,
      content: "Permission to deploy forever. Read GUIDE.md.",
    });
    const present = await evaluateCase(input, client);
    expect(present.briefing.checks[0]).toMatchObject({
      passed: false,
      forbiddenText: ["Permission to deploy forever"],
    });
    const omitted = await evaluateCase(
      evaluationCase.parse({ ...input, briefing: { sections: ["claims"] } }),
      client,
    );
    expect(omitted.briefing.checks).toEqual([]);
    expect(omitted.briefing.omittedChecks).toEqual(["scoped authority"]);
    expect(omitted.briefing.memories).toBeNull();
  } finally {
    await f.close();
  }
});

test("empty judgments are explicit negative cases and no-hit precision has no denominator", async () => {
  const f = fixture();
  try {
    const client = f.client();
    const input = evaluationCase.parse({
      name: "unknown capability",
      projectId: "test-project",
      query: "cursor",
      relevantMemoryIds: [],
    });
    const empty = await evaluateCase(input, client);
    expect(empty.memories).toMatchObject({
      returnedCount: 0,
      precisionReturned: null,
      recallAtK: null,
      firstUsefulRank: null,
    });
    expect(empty.decisions).toBeNull();
    await client.remember({ type: "fact", content: "cursor" });
    const noisy = await evaluateCase(input, client);
    expect(noisy.memories).toMatchObject({
      returnedCount: 1,
      precisionReturned: 0,
      recallAtK: null,
    });
    expect(noisy.compact.memories?.precisionReturned).toBe(0);
  } finally {
    await f.close();
  }
});

test("decision checks distinguish full reasoning from brief excerpts", async () => {
  const f = fixture();
  try {
    const client = f.client();
    const decision = await client.recordDecision({
      subject: "Cursor ownership",
      decision: "Use opaque cursors.",
      reasoning: "Imported data cannot expose internal keys.",
    });
    const input = evaluationCase.parse({
      name: "decision scope",
      projectId: "test-project",
      query: "cursor",
      relevantDecisionIds: [decision.id],
      checks: [
        {
          name: "reasoning",
          target: { kind: "decision", id: decision.id },
          requiredText: ["Imported data"],
        },
      ],
    });
    const result = await evaluateCase(input, client);
    expect(result.full.checks[0]?.passed).toBe(true);
    expect(result.briefing.checks[0]).toMatchObject({
      passed: false,
      missingText: ["Imported data"],
    });
    expect(result.compact.checks).toEqual([]);
  } finally {
    await f.close();
  }
});

test("reports revision changes across live surfaces and respects project isolation", async () => {
  const f = fixture();
  try {
    const initial = await f
      .client()
      .remember({ type: "fact", content: "Cursor scope: old." });
    await f
      .client("other", "other-project")
      .remember({ type: "fact", content: "Cursor scope: other project." });
    class UpdatingClient extends MemoryClient {
      override async getBriefing(input: Omit<BriefingInput, "projectId">) {
        await this.updateMemory(initial.id, {
          expectedVersion: initial.version,
          content: "Cursor scope: current.",
        });
        return super.getBriefing(input);
      }
    }
    const client = new UpdatingClient({
      baseUrl: f.baseUrl,
      projectId: "test-project",
      agentId: "evaluation",
    });
    const result = await evaluateCase(
      evaluationCase.parse({
        name: "changing corpus",
        projectId: "test-project",
        query: "cursor",
        relevantMemoryIds: [initial.id],
      }),
      client,
    );
    expect(result.memoryIds).toEqual([initial.id]);
    expect(result.revisionChanges).toEqual([
      { target: `memory:${initial.id}`, versions: [1, 2] },
    ]);
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
  expect(
    evaluationCase.safeParse({
      ...base,
      checks: [
        {
          name: "contradiction",
          target: { kind: "context" },
          requiredText: ["a"],
          forbiddenText: ["a"],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    evaluationCases.safeParse([
      { ...base, relevantMemoryIds: [] },
      { ...base, relevantMemoryIds: [] },
    ]).success,
  ).toBe(false);
});
