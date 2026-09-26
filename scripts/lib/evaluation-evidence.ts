import { z } from "zod";
import { identifier, type TextExcerpt } from "../../src/domain/contracts";

const version = z.number().int().positive();
const phrases = z
  .array(z.string().min(1))
  .refine(
    (items) => new Set(items).size === items.length,
    "Evidence phrases must be unique.",
  );

export const evidenceTarget = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("memory"),
    id: identifier,
    version: version.optional(),
  }),
  z.strictObject({ kind: z.literal("context"), version: version.optional() }),
  z.strictObject({ kind: z.literal("decision"), id: identifier }),
]);

export const evidenceCheck = z
  .strictObject({
    name: z.string().trim().min(1),
    target: evidenceTarget,
    requiredText: phrases.default([]),
    forbiddenText: phrases.default([]),
  })
  .refine(
    (check) => check.requiredText.length + check.forbiddenText.length > 0,
    "Supply evidence text to check.",
  )
  .refine(
    (check) =>
      !check.requiredText.some((text) => check.forbiddenText.includes(text)),
    "Evidence cannot be both required and forbidden.",
  );

export type EvidenceCheck = z.infer<typeof evidenceCheck>;
export type EvidenceRecord = {
  target: z.infer<typeof evidenceTarget>;
  excerpt: TextExcerpt;
};

export function targetKey(target: z.infer<typeof evidenceTarget>): string {
  return target.kind === "context" ? "context" : `${target.kind}:${target.id}`;
}

// Match every qualification in the same record. A second record cannot fill a
// truncated condition, and a different revision requires a fresh judgment.
export function checkEvidence(
  checks: EvidenceCheck[],
  records: EvidenceRecord[],
) {
  return checks.map((check) => {
    const record = records.find(
      (item) => targetKey(item.target) === targetKey(check.target),
    );
    const expectedVersion =
      check.target.kind === "decision" ? undefined : check.target.version;
    const observedVersion =
      record?.target.kind === "decision" ? undefined : record?.target.version;
    const status = !record
      ? "missing"
      : expectedVersion !== undefined && expectedVersion !== observedVersion
        ? "version_changed"
        : "observed";
    const text = record?.excerpt.text ?? "";
    const missingText = check.requiredText.filter(
      (phrase) => !text.includes(phrase),
    );
    const forbiddenText = check.forbiddenText.filter((phrase) =>
      text.includes(phrase),
    );
    return {
      name: check.name,
      target: check.target,
      observedVersion: observedVersion ?? null,
      status,
      truncated: record?.excerpt.truncated ?? null,
      missingText,
      forbiddenText,
      passed:
        status === "version_changed"
          ? null
          : status === "observed" &&
            missingText.length === 0 &&
            forbiddenText.length === 0,
    };
  });
}
