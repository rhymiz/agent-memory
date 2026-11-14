import {
  memorySchema,
  type Memory,
  type MemoryGetInput,
  type MemoryDeleteInput,
  type SearchInput,
  type MemoryFilter,
  type MemoryListInput,
} from "../domain/contracts";
import { storedMetadata, type SqliteStore } from "./sqlite-store";
import { z } from "zod";

export interface MemoryRepository {
  insert(memory: Memory): void;
  get(input: MemoryGetInput): Memory | null;
  update(memory: Memory, expectedVersion: number): boolean;
  delete(input: MemoryDeleteInput): boolean;
  search(input: SearchInput): Memory[];
  list(input: MemoryListInput): Memory[];
  replaceEmbeddings(
    memory: Memory,
    modelId: string,
    vectors: Float32Array[],
  ): void;
  getMany(projectId: string, ids: readonly string[]): Memory[];
  // Current chunk vectors for scoring, newest memory first. Memory records are
  // left out: a search scores every chunk but returns few memories.
  embeddings(
    projectId: string,
    modelId: string,
    dimensions: number,
    filter?: MemoryFilter,
  ): EmbeddedChunk[];
  unindexed(modelId: string, limit: number): Memory[];
}
export interface EmbeddedChunk {
  memoryId: string;
  createdAt: number;
  vector: Float32Array;
}
const chunkRow = z.strictObject({
  memoryId: z.string(),
  createdAt: z.number(),
  vector: z.instanceof(Uint8Array),
});
const row = memorySchema.extend({ metadata: storedMetadata });
const columns = `m.id, m.project_id AS projectId, m.agent_id AS agentId,
  m.type, m.content, m.importance, m.metadata, m.created_at AS createdAt,
  m.version, m.updated_by AS updatedBy, m.updated_at AS updatedAt`;
const filterSql = `(? IS NULL OR m.type IN (SELECT value FROM json_each(?)))
  AND (? IS NULL OR m.updated_at >= ?) AND (? IS NULL OR m.importance >= ?)`;
function filterParams(filter: MemoryFilter) {
  const types =
    filter.types === undefined ? null : JSON.stringify(filter.types);
  return [
    types,
    types,
    filter.updatedSince ?? null,
    filter.updatedSince ?? null,
    filter.minImportance ?? null,
    filter.minImportance ?? null,
  ];
}

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
    filter: MemoryFilter = {},
  ): EmbeddedChunk[] {
    const bytes = dimensions * Float32Array.BYTES_PER_ELEMENT;
    return this.store
      .all(
        chunkRow,
        `SELECT m.id AS memoryId, m.created_at AS createdAt, e.vector
       FROM memories m JOIN memory_embeddings e
       ON m.id = e.memory_id AND m.version = e.memory_version
       WHERE m.project_id = ? AND e.model_id = ? AND ${filterSql}
       ORDER BY m.created_at DESC, m.id DESC, e.chunk_index`,
        [projectId, modelId, ...filterParams(filter)],
      )
      .map(({ vector, ...chunk }) => {
        if (vector.byteLength !== bytes)
          throw new Error("Stored embedding has unexpected dimensions");
        // Vectors are normalized when written. Copy the bytes: a BLOB's offset
        // need not be aligned for a Float32Array view.
        return { ...chunk, vector: new Float32Array(vector.slice().buffer) };
      });
  }
  getMany(projectId: string, ids: readonly string[]): Memory[] {
    if (!ids.length) return [];
    return this.store.all(
      row,
      `SELECT ${columns} FROM memories m
      WHERE m.project_id = ? AND m.id IN (SELECT value FROM json_each(?))`,
      [projectId, JSON.stringify(ids)],
    );
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
      ) === 1
    );
  }
  delete(input: MemoryDeleteInput): boolean {
    return (
      this.store.execute(
        "DELETE FROM memories WHERE project_id = ? AND id = ? AND version = ?",
        [input.projectId, input.memoryId, input.expectedVersion],
      ) === 1
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
      WHERE memories_fts MATCH ? AND m.project_id = ? AND ${filterSql}
      ORDER BY bm25(memories_fts), m.created_at DESC, m.rowid DESC LIMIT ?`,
      [match, input.projectId, ...filterParams(input), input.limit ?? 10],
    );
  }
  list(input: MemoryListInput): Memory[] {
    return this.store.all(
      row,
      `SELECT ${columns} FROM memories m
      WHERE m.project_id = ? AND (? IS NULL OR m.id > ?) AND ${filterSql}
      ORDER BY m.id LIMIT ?`,
      [
        input.projectId,
        input.after ?? null,
        input.after ?? null,
        ...filterParams(input),
        (input.limit ?? 50) + 1,
      ],
    );
  }
}
