import { z } from "zod";
import type { SqlValue, SqliteStore } from "../repositories/sqlite-store";

const changes = z.strictObject({ count: z.number().int().nonnegative() });

function binding(value: SqlValue): SqlStorageValue {
  if (!(value instanceof Uint8Array)) return value;
  // Durable Object SQL binds BLOBs from ArrayBuffer; copy exactly the view's bytes.
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function row(value: Record<string, SqlStorageValue>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(value))
    result[key] =
      column instanceof ArrayBuffer ? new Uint8Array(column) : column;
  return result;
}

// SqliteStore over a SQLite-backed Durable Object. Every cursor is consumed
// synchronously, before the caller can await, as the runtime requires.
export class DurableObjectSqliteStore implements SqliteStore {
  private depth = 0;
  constructor(private readonly storage: DurableObjectStorage) {}
  run<T>(operation: () => T): T {
    // transactionSync cannot nest. Inner units join the outer transaction; no
    // caller catches an inner failure and continues, so the outer one rolls back.
    if (this.depth > 0) return operation();
    this.depth++;
    try {
      return this.storage.transactionSync(operation);
    } finally {
      this.depth--;
    }
  }
  private rows(sql: string, params: SqlValue[]): Record<string, unknown>[] {
    return this.storage.sql
      .exec(sql, ...params.map(binding))
      .toArray()
      .map(row);
  }
  get<T>(schema: z.ZodType<T>, sql: string, params: SqlValue[] = []): T | null {
    const [first] = this.rows(sql, params);
    return first === undefined ? null : schema.parse(first);
  }
  all<T>(schema: z.ZodType<T>, sql: string, params: SqlValue[] = []): T[] {
    return z.array(schema).parse(this.rows(sql, params));
  }
  execute(sql: string, params: SqlValue[] = []): number {
    this.rows(sql, params);
    return changes.parse(this.rows("SELECT changes() AS count", [])[0]).count;
  }
  script(sql: string): void {
    this.storage.sql.exec(sql).toArray();
  }
  health(): void {
    this.rows("SELECT 1", []);
  }
}
