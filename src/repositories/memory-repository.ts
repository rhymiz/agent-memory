import {
  memorySchema,
  type Memory,
  type SearchInput,
} from "../domain/contracts";
import { SqliteStore, storedMetadata } from "./sqlite-store";

export interface MemoryRepository {
  insert(memory: Memory): void;
  search(input: SearchInput): Memory[];
}
const row = memorySchema.extend({ metadata: storedMetadata });

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly store: SqliteStore) {}
  insert(memory: Memory): void {
    this.store.execute(
      "INSERT INTO memories (id,project_id,agent_id,type,content,importance,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        memory.id,
        memory.projectId,
        memory.agentId,
        memory.type,
        memory.content,
        memory.importance,
        memory.metadata === null ? null : JSON.stringify(memory.metadata),
        memory.createdAt,
      ],
    );
  }
  search(input: SearchInput): Memory[] {
    // Treat queries as plain words, never as FTS syntax. Keep retrieval-specific details here.
    const words = input.query.match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [];
    if (!words.length) return [];
    const match = words.map((word) => `"${word}"`).join(" AND ");
    return this.store.all(
      row,
      `SELECT m.id, m.project_id AS projectId, m.agent_id AS agentId,
      m.type, m.content, m.importance, m.metadata, m.created_at AS createdAt
      FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ? AND m.project_id = ?
      ORDER BY bm25(memories_fts), m.created_at DESC, m.rowid DESC LIMIT ?`,
      [match, input.projectId, input.limit ?? 10],
    );
  }
}
