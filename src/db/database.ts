import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrate";

export function openDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;",
    );
    migrate(db);
    return db;
  } catch (error) {
    db.close(true);
    throw error;
  }
}
