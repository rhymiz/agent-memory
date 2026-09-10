import type { Database } from "bun:sqlite";
import { z } from "zod";
import initial from "./migrations/001_initial.sql" with { type: "text" };

const migrations = [{ version: 1, sql: initial }];

export function migrate(db: Database): void {
  db.transaction(() => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT",
    );
    const rows = z
      .array(z.object({ version: z.number().int() }))
      .parse(
        db
          .query("SELECT version FROM schema_migrations ORDER BY version")
          .all(),
      );
    if (
      rows.some(
        (row) =>
          !migrations.some((migration) => migration.version === row.version),
      )
    ) {
      throw new Error(
        "Database schema is newer than this daemon. Upgrade agent-memory.",
      );
    }
    for (const migration of migrations) {
      if (rows.some((row) => row.version === migration.version)) continue;
      db.exec(migration.sql);
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(migration.version, Date.now());
    }
  }).immediate();
}
