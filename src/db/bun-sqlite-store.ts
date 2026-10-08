import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { SqlValue, SqliteStore } from "../repositories/sqlite-store";

const changes = z.strictObject({ count: z.number().int().nonnegative() });

export class BunSqliteStore implements SqliteStore {
  constructor(private readonly db: Database) {}
  run<T>(operation: () => T): T {
    return this.db.transaction(operation).immediate();
  }
  get<T>(schema: z.ZodType<T>, sql: string, params: SqlValue[] = []): T | null {
    const row: unknown = this.db.query(sql).get(...params);
    return row === null ? null : schema.parse(row);
  }
  all<T>(schema: z.ZodType<T>, sql: string, params: SqlValue[] = []): T[] {
    return z.array(schema).parse(this.db.query(sql).all(...params));
  }
  execute(sql: string, params: SqlValue[] = []): number {
    this.db.query(sql).run(...params);
    // Bun's run().changes includes trigger writes; changes() reports only this statement.
    return changes.parse(this.db.query("SELECT changes() AS count").get())
      .count;
  }
  script(sql: string): void {
    this.db.exec(sql);
  }
  health(): void {
    this.db.query("SELECT 1").get();
  }
}
