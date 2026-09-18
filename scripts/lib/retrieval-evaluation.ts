import { z } from "zod";
import {
  identifier,
  memoryFilter,
  searchInput,
} from "../../src/domain/contracts";
import type { MemoryClient } from "../../src/client/memory-client";

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
    relevantMemoryIds: ids.default([]),
    staleMemoryIds: ids.default([]),
    relevantDecisionIds: ids.default([]),
    decisionQuery: searchInput.shape.query.optional(),
  })
  .refine(
    (item) =>
      item.relevantMemoryIds.length + item.relevantDecisionIds.length > 0,
    "Supply at least one expected memory or decision.",
  )
  .refine(
    (item) =>
      !item.relevantMemoryIds.some((id) => item.staleMemoryIds.includes(id)),
    "A memory cannot be judged both relevant and stale.",
  );
export const evaluationCases = z.array(evaluationCase).min(1);

function score(returned: string[], relevant: string[], limit: number) {
  if (!relevant.length) return null;
  const hits = returned.filter((id) => relevant.includes(id));
  const first = returned.findIndex((id) => relevant.includes(id));
  return {
    precisionAtK: hits.length / limit,
    recallAtK: hits.length / relevant.length,
    reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
    missingIds: relevant.filter((id) => !hits.includes(id)),
  };
}

export async function evaluateCase(
  input: z.infer<typeof evaluationCase>,
  client: MemoryClient,
) {
  const memories = await client.search({
    query: input.query,
    limit: input.limit,
    ...input.memoryFilter,
  });
  const memoryIds = memories.items.map((item) => item.id);
  const decisionIds = input.relevantDecisionIds.length
    ? (
        await client.listDecisions({
          query: input.decisionQuery ?? input.query,
          status: "active",
          limit: input.limit,
        })
      ).items.map((item) => item.id)
    : [];
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
  };
}
