import { z } from "zod";

export const identifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const content = z
  .string()
  .min(1)
  .max(100_000)
  .refine((value) => value.trim().length > 0, "Content must not be blank.");
export const metadata = z.record(z.string(), z.json());
export const timestamp = z.number().int().nonnegative();
export const limit = z.number().int().min(1).max(200);
export const ttlSeconds = z.number().int().min(1).max(2_147_483_647);
export const projectInput = z.strictObject({ projectId: identifier });
export const actorInput = projectInput.extend({ agentId: identifier });
export const memoryType = z.enum([
  "fact",
  "observation",
  "decision",
  "constraint",
  "note",
  "result",
]);
export const decisionStatus = z.enum(["active", "superseded"]);
export const activityType = z.enum([
  "memory.created",
  "memory.updated",
  "memory.deleted",
  "claim.acquired",
  "claim.released",
  "claim.renewed",
  "claim.expired",
  "context.updated",
  "decision.created",
  "decision.superseded",
]);

export const rememberInput = actorInput.extend({
  type: memoryType,
  content,
  importance: z.number().min(0).max(1).optional(),
  metadata: metadata.optional(),
});
export const searchInput = projectInput.extend({
  query: z.string().trim().min(1).max(1000),
  limit: limit.optional(),
});
export const memoryGetInput = projectInput.extend({ memoryId: identifier });
export const memoryDeleteBody = actorInput.extend({
  expectedVersion: z.number().int().positive(),
});
export const memoryDeleteInput = memoryDeleteBody.extend({
  memoryId: identifier,
});
export const memoryUpdateBody = memoryDeleteBody.extend({
  type: memoryType.optional(),
  content: content.optional(),
  importance: z.number().min(0).max(1).nullable().optional(),
  metadata: metadata.nullable().optional(),
});
export const memoryUpdateInput = memoryUpdateBody
  .extend({ memoryId: identifier })
  .refine(
    (input) =>
      input.type !== undefined ||
      input.content !== undefined ||
      input.importance !== undefined ||
      input.metadata !== undefined,
    "Provide at least one memory field to update.",
  );
export const acquireInput = actorInput.extend({
  resource: z.string().trim().min(1).max(1024),
  intent: z.string().trim().min(1).max(2000).optional(),
  ttlSeconds: ttlSeconds.optional(),
});
export const releaseInput = z.strictObject({
  claimId: identifier,
  agentId: identifier,
});
export const renewInput = releaseInput.extend({
  ttlSeconds: ttlSeconds.optional(),
});
export const renewClaimsInput = actorInput.extend({
  claimIds: z
    .array(identifier)
    .min(1)
    .max(500)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "claimIds must be unique.",
    ),
  ttlSeconds: ttlSeconds.optional(),
});
export const claimsRenewed = z.strictObject({
  claimCount: z.number().int().positive(),
  renewedCount: z.number().int().nonnegative(),
  expiresAt: timestamp,
  renewAfter: timestamp,
});
export const claimsInput = projectInput.extend({
  resource: z.string().trim().min(1).max(1024).optional(),
});
export const contextUpdateBody = z.strictObject({
  agentId: identifier,
  expectedVersion: z.number().int().nonnegative(),
  content,
});
export const contextUpdateInput = projectInput.extend(contextUpdateBody.shape);
export const decisionBody = z.strictObject({
  agentId: identifier,
  subject: z.string().trim().min(1).max(256),
  decision: content,
  reasoning: content.optional(),
  supersedesId: identifier.optional(),
});
export const decisionInput = projectInput.extend(decisionBody.shape);
export const decisionsInput = projectInput.extend({
  status: decisionStatus.optional(),
  limit: limit.optional(),
});
export const activityInput = projectInput.extend({
  limit: limit.optional(),
  since: timestamp.optional(),
  agentId: identifier.optional(),
  type: activityType.optional(),
});

export const memorySchema = z.strictObject({
  id: identifier,
  projectId: identifier,
  agentId: identifier,
  type: memoryType,
  content,
  importance: z.number().min(0).max(1).nullable(),
  metadata: metadata.nullable(),
  createdAt: timestamp,
  version: z.number().int().positive(),
  updatedBy: identifier,
  updatedAt: timestamp,
});
export const memoryDeleted = z.strictObject({
  deleted: z.literal(true),
  memoryId: identifier,
});
export const claimSchema = z.strictObject({
  id: identifier,
  projectId: identifier,
  agentId: identifier,
  resource: z.string(),
  intent: z.string().nullable(),
  expiresAt: timestamp,
  createdAt: timestamp,
});
export const contextSchema = z.strictObject({
  projectId: identifier,
  content,
  version: z.number().int().positive(),
  updatedBy: identifier,
  updatedAt: timestamp,
});
export const decisionSchema = z.strictObject({
  id: identifier,
  projectId: identifier,
  agentId: identifier,
  subject: z.string(),
  decision: content,
  reasoning: z.string().nullable(),
  status: decisionStatus,
  supersedesId: identifier.nullable(),
  createdAt: timestamp,
});
export const activitySchema = z.strictObject({
  id: identifier,
  projectId: identifier,
  agentId: identifier,
  type: activityType,
  resource: z.string().nullable(),
  message: z.string().nullable(),
  metadata: metadata.nullable(),
  createdAt: timestamp,
});
export const memoriesResult = z.strictObject({ items: z.array(memorySchema) });
export const claimsResult = z.strictObject({ items: z.array(claimSchema) });
export const decisionsResult = z.strictObject({
  items: z.array(decisionSchema),
});
export const activityResult = z.strictObject({
  items: z.array(activitySchema),
});
export const claimGranted = z.strictObject({
  granted: z.literal(true),
  claim: claimSchema,
});
export const claimReleased = z.strictObject({
  released: z.literal(true),
  claimId: identifier,
});
export const healthSchema = z.strictObject({
  status: z.literal("ok"),
  database: z.literal("ok"),
  version: z.string(),
});

export type Memory = z.infer<typeof memorySchema>;
export type Claim = z.infer<typeof claimSchema>;
export type ProjectContext = z.infer<typeof contextSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type ActivityEvent = z.infer<typeof activitySchema>;
export type Metadata = z.infer<typeof metadata>;
export type RememberInput = z.infer<typeof rememberInput>;
export type SearchInput = z.infer<typeof searchInput>;
export type MemoryGetInput = z.infer<typeof memoryGetInput>;
export type MemoryUpdateInput = z.infer<typeof memoryUpdateInput>;
export type MemoryDeleteInput = z.infer<typeof memoryDeleteInput>;
export type MemoryDeleted = z.infer<typeof memoryDeleted>;
export type AcquireInput = z.infer<typeof acquireInput>;
export type ReleaseInput = z.infer<typeof releaseInput>;
export type RenewInput = z.infer<typeof renewInput>;
export type RenewClaimsInput = z.infer<typeof renewClaimsInput>;
export type ClaimsRenewed = z.infer<typeof claimsRenewed>;
export type ClaimsInput = z.infer<typeof claimsInput>;
export type ProjectInput = z.infer<typeof projectInput>;
export type ContextUpdateInput = z.infer<typeof contextUpdateInput>;
export type DecisionInput = z.infer<typeof decisionInput>;
export type DecisionsInput = z.infer<typeof decisionsInput>;
export type ActivityInput = z.infer<typeof activityInput>;
