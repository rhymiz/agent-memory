import {
  memorySchema,
  type Memory,
  type MemoryGetInput,
  type MemoryDeleteInput,
  type SearchInput,
} from "../domain/contracts";
import { SqliteStore, storedMetadata } from "./sqlite-store";
import { z } from "zod";
import { normalized } from "../domain/embedding";

export interface MemoryRepository {
  insert(memory: Memory): void;
  get(input: MemoryGetInput): Memory | null;
  update(memory: Memory, expectedVersion: number): boolean;
  delete(input: MemoryDeleteInput): boolean;
  search(input: SearchInput): Memory[];
  replaceEmbeddings(
    memory: Memory,
    modelId: string,
    vectors: Float32Array[],
  ): void;
  embeddings(
    projectId: string,
    modelId: string,
    dimensions: number,
  ): { memory: Memory; vector: Float32Array }[];
  unindexed(modelId: string, limit: number): Memory[];
}
const row = memorySchema.extend({ metadata: storedMetadata });
const columns = `m.id, m.project_id AS projectId, m.agent_id AS agentId,
  m.type, m.content, m.importance, m.metadata, m.created_at AS createdAt,
  m.version, m.updated_by AS updatedBy, m.updated_at AS updatedAt`;

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly store: SqliteStore) {}
  replaceEmbeddings(
    memory: Memory,
    modelId: string,
    vectors: Float32Array[],
  ): void {
    this.store.execute("DELETE FROM memory_embeddings WHERE memory_id = ?", [
      memory.id,
    ]);
    for (const [index, vector] of vectors.entries()) {
      this.store.execute(
        "INSERT INTO memory_embeddings (memory_id, memory_version, model_id, chunk_index, vector) VALUES (?,?,?,?,?)",
        [
          memory.id,
          memory.version,
          modelId,
          index,
          new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
        ],
      );
    }
  }
  embeddings(
    projectId: string,
    modelId: string,
    dimensions: number,
  ): { memory: Memory; vector: Float32Array }[] {
    return this.store
      .all(
        row.extend({ vector: z.instanceof(Uint8Array) }),
        `SELECT ${columns}, e.vector FROM memories m JOIN memory_embeddings e
       ON m.id = e.memory_id AND m.version = e.memory_version
       WHERE m.project_id = ? AND e.model_id = ? ORDER BY m.created_at DESC, m.id DESC, e.chunk_index`,
        [projectId, modelId],
      )
      .map(({ vector, ...memory }) => ({
        memory,
        vector: normalized(
          new Float32Array(Uint8Array.from(vector).buffer),
          dimensions,
        ),
      }));
  }
  unindexed(modelId: string, limit: number): Memory[] {
    return this.store.all(
      row,
      `SELECT ${columns} FROM memories m WHERE NOT EXISTS (
      SELECT 1 FROM memory_embeddings e WHERE e.memory_id = m.id AND e.memory_version = m.version AND e.model_id = ?
    ) ORDER BY m.id LIMIT ?`,
      [modelId, limit],
    );
  }
  insert(memory: Memory): void {
    this.store.execute(
      "INSERT INTO memories (id,project_id,agent_id,type,content,importance,metadata,created_at,version,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        memory.id,
        memory.projectId,
        memory.agentId,
        memory.type,
        memory.content,
        memory.importance,
        memory.metadata === null ? null : JSON.stringify(memory.metadata),
        memory.createdAt,
        memory.version,
        memory.updatedBy,
        memory.updatedAt,
      ],
    );
  }
  get(input: MemoryGetInput): Memory | null {
    return this.store.get(
      row,
      `SELECT ${columns} FROM memories m WHERE m.project_id = ? AND m.id = ?`,
      [input.projectId, input.memoryId],
    );
  }
  update(memory: Memory, expectedVersion: number): boolean {
    // Bun counts FTS trigger writes too; the unique ID limits the target to one memory.
    return (
      this.store.execute(
        `UPDATE memories SET type = ?, content = ?, importance = ?, metadata = ?,
        version = ?, updated_by = ?, updated_at = ?
        WHERE project_id = ? AND id = ? AND version = ?`,
        [
          memory.type,
          memory.content,
          memory.importance,
          memory.metadata === null ? null : JSON.stringify(memory.metadata),
          memory.version,
          memory.updatedBy,
          memory.updatedAt,
          memory.projectId,
          memory.id,
          expectedVersion,
        ],
      ) > 0
    );
  }
  delete(input: MemoryDeleteInput): boolean {
    return (
      this.store.execute(
        "DELETE FROM memories WHERE project_id = ? AND id = ? AND version = ?",
        [input.projectId, input.memoryId, input.expectedVersion],
      ) > 0
    );
  }
  search(input: SearchInput): Memory[] {
    // Treat queries as plain words, never as FTS syntax. Keep retrieval-specific details here.
    const words = input.query.match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [];
    if (!words.length) return [];
    const match = words.map((word) => `"${word}"`).join(" AND ");
    return this.store.all(
      row,
      `SELECT ${columns}
      FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ? AND m.project_id = ?
      ORDER BY bm25(memories_fts), m.created_at DESC, m.rowid DESC LIMIT ?`,
      [match, input.projectId, input.limit ?? 10],
    );
  }
}
