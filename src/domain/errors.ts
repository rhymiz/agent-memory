import { z } from "zod";
import { metadata, type Metadata } from "./contracts";

export const errorCode = z.enum([
  "INVALID_REQUEST",
  "PROJECT_NOT_FOUND",
  "MEMORY_NOT_FOUND",
  "MEMORY_VERSION_CONFLICT",
  "CLAIM_NOT_FOUND",
  "CLAIM_CONFLICT",
  "CLAIM_NOT_OWNER",
  "CLAIM_EXPIRED",
  "CONTEXT_VERSION_CONFLICT",
  "DECISION_NOT_FOUND",
  "DECISION_CONFLICT",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "FORBIDDEN",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof errorCode>;
export const errorResponse = z.object({
  error: z.strictObject({
    code: errorCode,
    message: z.string(),
    details: metadata.optional(),
  }),
});

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 400,
    public readonly details?: Metadata,
  ) {
    super(message);
    this.name = "AppError";
  }
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("INVALID_REQUEST", "Input validation failed.", 400, {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  console.error(
    JSON.stringify({
      level: "error",
      event: "request.failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  return new AppError("INTERNAL_ERROR", "An internal error occurred.", 500);
}
