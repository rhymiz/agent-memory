import { z } from "zod";
import {
  identifier,
  memoryFilter,
  briefingInput,
  responseBudget,
  searchInput,
  type Memory,
  type Decision,
  type ProjectContext,
} from "../../src/domain/contracts";
import {
  MemoryClientError,
  type MemoryClient,
} from "../../src/client/memory-client";
import { jsonBytes } from "../../src/domain/projections";
import {
  checkEvidence,
  evidenceCheck,
  targetKey,
  type EvidenceRecord,
} from "./evaluation-evidence";

const ids = z
  .array(identifier)
  .refine(
    (items) => new Set(items).size === items.length,
    "Judged IDs must be unique.",
  );
export const evaluationCase = z
  .strictObject({
    name: z.string().trim().min(1),
    projectId: identifier,
    query: searchInput.shape.query,
    limit: z.number().int().min(1).max(50).default(5),
    memoryFilter: memoryFilter.optional(),
    relevantMemoryIds: ids.optional(),
    staleMemoryIds: ids.default([]),
    relevantDecisionIds: ids.optional(),
    decisionQuery: searchInput.shape.query.optional(),
    compactMaxBytes: responseBudget.optional(),
    briefing: briefingInput
      .omit({ projectId: true, query: true, memoryFilter: true })
      .optional(),
    checks: z.array(evidenceCheck).default([]),
  })
  .refine(
    (item) =>
      item.relevantMemoryIds !== undefined ||
      item.relevantDecisionIds !== undefined ||
      item.checks.length > 0,
    "Supply explicit relevance judgments or evidence checks.",
  )
  .refine(
    (item) =>
      !item.relevantMemoryIds?.some((id) => item.staleMemoryIds.includes(id)),
    "A memory cannot be judged both relevant and stale.",
  )
  .refine(
    (item) =>
      new Set(item.checks.map((check) => check.name)).size ===
      item.checks.length,
    "Evidence check names must be unique.",
  );
export const evaluationCases = z
  .array(evaluationCase)
  .min(1)
  .refine(
    (items) => new Set(items.map((item) => item.name)).size === items.length,
    "Case names must be unique.",
  );

function score(
  returned: string[],
  relevant: string[] | undefined,
  limit: number,
) {
  if (relevant === undefined) return null;
  const hits = returned.filter((id) => relevant.includes(id));
  const first = returned.findIndex((id) => relevant.includes(id));
  return {
    precisionAtK: hits.length / limit,
    precisionReturned: returned.length ? hits.length / returned.length : null,
    recallAtK: relevant.length ? hits.length / relevant.length : null,
    firstUsefulRank: first < 0 ? null : first + 1,
    reciprocalRank: relevant.length ? (first < 0 ? 0 : 1 / (first + 1)) : null,
    returnedCount: returned.length,
    missingIds: relevant.filter((id) => !hits.includes(id)),
  };
}

function memoryEvidence(item: Memory): EvidenceRecord {
  return {
    target: { kind: "memory", id: item.id, version: item.version },
    excerpt: { text: item.content, truncated: false },
  };
}

function decisionEvidence(item: Decision): EvidenceRecord {
  return {
    target: { kind: "decision", id: item.id },
    excerpt: {
      text: [item.subject, item.decision, item.reasoning]
        .filter((text) => text !== null)
        .join("\n"),
      truncated: false,
    },
  };
}

function contextEvidence(item: ProjectContext): EvidenceRecord {
  return {
    target: { kind: "context", version: item.version },
    excerpt: { text: item.content, truncated: false },
  };
}

export async function evaluateCase(
  input: z.infer<typeof evaluationCase>,
  client: MemoryClient,
) {
  const search = {
    query: input.query,
    limit: input.limit,
    ...input.memoryFilter,
  };
  const [memories, compact, briefing] = await Promise.all([
    client.search(search),
    client.searchCompact({ ...search, maxBytes: input.compactMaxBytes }),
    client.getBriefing({
      ...input.briefing,
      query: input.query,
      memoryFilter: input.memoryFilter,
    }),
  ]);
  const memoryIds = memories.items.map((item) => item.id);
  const needsDecisions =
    input.relevantDecisionIds !== undefined ||
    input.checks.some((check) => check.target.kind === "decision");
  const decisions = needsDecisions
    ? await client.listDecisions({
        query: input.decisionQuery ?? input.query,
        status: "active",
        limit: input.limit,
      })
    : null;
  const decisionIds = decisions?.items.map((item) => item.id) ?? [];
  let context: ProjectContext | null = null;
  if (input.checks.some((check) => check.target.kind === "context")) {
    try {
      context = await client.getContext();
    } catch (error) {
      if (
        !(error instanceof MemoryClientError) ||
        error.code !== "PROJECT_NOT_FOUND"
      )
        throw error;
    }
  }
  const fullRecords = [
    ...memories.items.map(memoryEvidence),
    ...(decisions?.items.map(decisionEvidence) ?? []),
    ...(context ? [contextEvidence(context)] : []),
  ];
  const compactRecords: EvidenceRecord[] = compact.items.map((item) => ({
    target: { kind: "memory", id: item.id, version: item.version },
    excerpt: item.excerpt,
  }));
  const briefingRecords: EvidenceRecord[] = [
    ...(briefing.memories?.items.map((item): EvidenceRecord => ({
      target: { kind: "memory", id: item.id, version: item.version },
      excerpt: item.excerpt,
    })) ?? []),
    ...(briefing.context?.items.map((item): EvidenceRecord => ({
      target: { kind: "context", version: item.version },
      excerpt: item.excerpt,
    })) ?? []),
    ...(briefing.decisions?.items.map((item): EvidenceRecord => ({
      target: { kind: "decision", id: item.id },
      excerpt: item.excerpt,
    })) ?? []),
  ];
  const versions = new Map<string, Set<number>>();
  for (const record of [
    ...fullRecords,
    ...compactRecords,
    ...briefingRecords,
  ]) {
    if (
      record.target.kind === "decision" ||
      record.target.version === undefined
    )
      continue;
    const key = targetKey(record.target);
    const observed = versions.get(key) ?? new Set<number>();
    observed.add(record.target.version);
    versions.set(key, observed);
  }
  const revisionChanges = [...versions]
    .filter(([, observed]) => observed.size > 1)
    .map(([target, observed]) => ({ target, versions: [...observed] }));
  const compactIds = compact.items.map((item) => item.id);
  const briefMemoryIds = briefing.memories?.items.map((item) => item.id) ?? [];
  const briefDecisionIds =
    briefing.decisions?.items.map((item) => item.id) ?? [];
  const briefChecks = input.checks.filter(
    (check) =>
      briefing[
        check.target.kind === "memory"
          ? "memories"
          : check.target.kind === "decision"
            ? "decisions"
            : "context"
      ] !== undefined,
  );
  return {
    name: input.name,
    projectId: input.projectId,
    query: input.query,
    limit: input.limit,
    memoryFilter: input.memoryFilter ?? {},
    memoryIds,
    decisionIds,
    memories: score(memoryIds, input.relevantMemoryIds, input.limit),
    decisions: score(decisionIds, input.relevantDecisionIds, input.limit),
    staleMemoryIds: memoryIds.filter((id) => input.staleMemoryIds.includes(id)),
    full: {
      bytes: jsonBytes({ memories, decisions, context }),
      records: fullRecords,
      checks: checkEvidence(input.checks, fullRecords),
    },
    compact: {
      bytes: jsonBytes(compact),
      response: compact,
      memories: score(compactIds, input.relevantMemoryIds, input.limit),
      staleMemoryIds: compactIds.filter((id) =>
        input.staleMemoryIds.includes(id),
      ),
      checks: checkEvidence(
        input.checks.filter((check) => check.target.kind === "memory"),
        compactRecords,
      ),
    },
    briefing: {
      bytes: jsonBytes(briefing),
      response: briefing,
      memories: briefing.memories
        ? score(briefMemoryIds, input.relevantMemoryIds, 5)
        : null,
      decisions: briefing.decisions
        ? score(briefDecisionIds, input.relevantDecisionIds, 5)
        : null,
      staleMemoryIds: briefMemoryIds.filter((id) =>
        input.staleMemoryIds.includes(id),
      ),
      checks: checkEvidence(briefChecks, briefingRecords),
      omittedChecks: input.checks
        .filter((check) => !briefChecks.includes(check))
        .map((check) => check.name),
    },
    revisionChanges,
  };
}
