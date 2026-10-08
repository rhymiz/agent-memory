import { z } from "zod";
import type { SqliteStore } from "../repositories/sqlite-store";
import initial from "./migrations/001_initial.sql" with { type: "text" };
import memoryMutations from "./migrations/002_memory_mutations.sql" with { type: "text" };
import embeddings from "./migrations/003_embeddings.sql" with { type: "text" };
import decisionSearch from "./migrations/004_decision_search.sql" with { type: "text" };
import credentials from "./migrations/credentials/001_credentials.sql" with { type: "text" };

export interface Migration {
  version: number;
  sql: string;
}

// Project memory, owned by the daemon or by one account's Durable Object.
export const memoryMigrations: readonly Migration[] = [
  { version: 1, sql: initial },
  { version: 2, sql: memoryMutations },
  { version: 3, sql: embeddings },
  { version: 4, sql: decisionSearch },
];
// Hosted service API keys, owned by the credential registry.
export const credentialMigrations: readonly Migration[] = [
  { version: 1, sql: credentials },
];

export function migrate(
  store: SqliteStore,
  migrations: readonly Migration[],
  now: () => number,
): void {
  store.run(() => {
    store.script(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT",
    );
    const rows = store.all(
      z.object({ version: z.number().int() }),
      "SELECT version FROM schema_migrations ORDER BY version",
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
      store.script(migration.sql);
      store.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        [migration.version, now()],
      );
    }
  });
}
