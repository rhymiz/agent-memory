import { z } from "zod";
import { metadata } from "../domain/contracts";

export interface UnitOfWork {
  run<T>(operation: () => T): T;
}

export type SqlValue = string | number | null | Uint8Array;

// A synchronous SQLite connection owned by one process or Durable Object.
// Drivers return BLOB columns as Uint8Array and report the rows changed by the
// statement itself, excluding trigger writes.
export interface SqliteStore extends UnitOfWork {
  get<T>(schema: z.ZodType<T>, sql: string, params?: SqlValue[]): T | null;
  all<T>(schema: z.ZodType<T>, sql: string, params?: SqlValue[]): T[];
  execute(sql: string, params?: SqlValue[]): number;
  script(sql: string): void;
  health(): void;
}

export const storedMetadata = z.preprocess((value: unknown) => {
  if (typeof value !== "string") return value;
  const parsed: unknown = JSON.parse(value);
  return parsed;
}, metadata.nullable());
