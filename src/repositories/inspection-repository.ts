import { z } from "zod";
import {
  corpusStats,
  memoryType,
  projectInput,
  type CorpusStats,
  type InspectionInput,
  type PageInput,
  type ProjectInput,
} from "../domain/contracts";
import { SqliteStore } from "./sqlite-store";

export interface InspectionRepository {
  projects(input: PageInput): ProjectInput[];
  stats(input: InspectionInput, now: number, modelId: string): CorpusStats;
}

const projectIds = `SELECT project_id FROM memories UNION SELECT project_id FROM decisions
  UNION SELECT project_id FROM project_contexts UNION SELECT project_id FROM claims
  UNION SELECT project_id FROM activity`;
const count = z.number().int().nonnegative();
const countRow = z.strictObject({ count });

export class SqliteInspectionRepository implements InspectionRepository {
  constructor(private readonly store: SqliteStore) {}
  projects(input: PageInput): ProjectInput[] {
    return this.store.all(
      projectInput,
      `SELECT project_id AS projectId FROM (${projectIds})
      WHERE (? IS NULL OR project_id > ?) ORDER BY project_id LIMIT ?`,
      [input.after ?? null, input.after ?? null, (input.limit ?? 50) + 1],
    );
  }
  stats(input: InspectionInput, now: number, modelId: string): CorpusStats {
    const scope = [input.projectId ?? null, input.projectId ?? null];
    const where = "(? IS NULL OR project_id = ?)";
    const memories = this.store.all(
      z.strictObject({ type: memoryType, count, bytes: count }),
      `SELECT type, COUNT(*) AS count, SUM(length(CAST(content AS BLOB))) AS bytes
       FROM memories WHERE ${where} GROUP BY type`,
      scope,
    );
    const decisions = this.store.all(
      z.strictObject({ status: z.enum(["active", "superseded"]), count }),
      `SELECT status, COUNT(*) AS count FROM decisions WHERE ${where} GROUP BY status`,
      scope,
    );
    const claims = this.store.get(
      z.strictObject({ active: count, expired: count }),
      `SELECT COUNT(CASE WHEN expires_at > ? THEN 1 END) AS active,
       COUNT(CASE WHEN expires_at <= ? THEN 1 END) AS expired FROM claims WHERE ${where}`,
      [now, now, ...scope],
    );
    const activity = this.store.get(
      z.strictObject({ coordination: count, knowledge: count }),
      `SELECT COUNT(CASE WHEN type LIKE 'claim.%' THEN 1 END) AS coordination,
       COUNT(CASE WHEN type NOT LIKE 'claim.%' THEN 1 END) AS knowledge FROM activity WHERE ${where}`,
      scope,
    );
    const embeddings = this.store.get(
      z.strictObject({ memories: count, chunks: count }),
      `SELECT COUNT(DISTINCT m.id) AS memories, COUNT(*) AS chunks FROM memory_embeddings e
       JOIN memories m ON m.id = e.memory_id AND m.version = e.memory_version
       WHERE (? IS NULL OR m.project_id = ?) AND e.model_id = ?`,
      [...scope, modelId],
    );
    const models = this.store.all(
      z.strictObject({ model: z.string() }),
      `SELECT DISTINCT e.model_id AS model FROM memory_embeddings e
       JOIN memories m ON m.id = e.memory_id AND m.version = e.memory_version
       WHERE (? IS NULL OR m.project_id = ?) ORDER BY model`,
      scope,
    );
    return corpusStats.parse({
      asOf: now,
      projects: this.store.get(
        countRow,
        `SELECT COUNT(*) AS count FROM (${projectIds}) WHERE ${where}`,
        scope,
      )?.count,
      memories: {
        total: memories.reduce((total, item) => total + item.count, 0),
        contentBytes: memories.reduce((total, item) => total + item.bytes, 0),
        byType: memoryType.options.map((type) => ({
          type,
          count: memories.find((item) => item.type === type)?.count ?? 0,
        })),
      },
      decisions: {
        active: decisions.find((item) => item.status === "active")?.count ?? 0,
        superseded:
          decisions.find((item) => item.status === "superseded")?.count ?? 0,
      },
      contexts: this.store.get(
        countRow,
        `SELECT COUNT(*) AS count FROM project_contexts WHERE ${where}`,
        scope,
      )?.count,
      claims,
      activity,
      embeddings: {
        ...embeddings,
        modelId,
        models: models.map((item) => item.model),
      },
    });
  }
}
