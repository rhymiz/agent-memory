import type { Database, SQLQueryBindings } from "bun:sqlite";
import { z } from "zod";
import { metadata } from "../domain/contracts";

export interface UnitOfWork {
  run<T>(operation: () => T): T;
}

export class SqliteStore implements UnitOfWork {
  constructor(private readonly db: Database) {}
  run<T>(operation: () => T): T {
    return this.db.transaction(operation).immediate();
  }
  get<T>(
    schema: z.ZodType<T>,
    sql: string,
    params: SQLQueryBindings[] = [],
  ): T | null {
    const row: unknown = this.db.query(sql).get(...params);
    return row === null ? null : schema.parse(row);
  }
  all<T>(
    schema: z.ZodType<T>,
    sql: string,
    params: SQLQueryBindings[] = [],
  ): T[] {
    return z.array(schema).parse(this.db.query(sql).all(...params));
  }
  execute(sql: string, params: SQLQueryBindings[] = []): number {
    return this.db.query(sql).run(...params).changes;
  }
  health(): void {
    this.db.query("SELECT 1").get();
  }
}

export const storedMetadata = z.preprocess((value: unknown) => {
  if (typeof value !== "string") return value;
  const parsed: unknown = JSON.parse(value);
  return parsed;
}, metadata.nullable());
