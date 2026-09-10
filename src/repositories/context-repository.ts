import { contextSchema, type ProjectContext } from "../domain/contracts";
import { SqliteStore } from "./sqlite-store";

export interface ContextRepository {
  get(projectId: string): ProjectContext | null;
  insert(context: ProjectContext): void;
  update(context: ProjectContext, expectedVersion: number): boolean;
}
export class SqliteContextRepository implements ContextRepository {
  constructor(private readonly store: SqliteStore) {}
  get(projectId: string) {
    return this.store.get(
      contextSchema,
      "SELECT project_id AS projectId, content, version, updated_by AS updatedBy, updated_at AS updatedAt FROM project_contexts WHERE project_id = ?",
      [projectId],
    );
  }
  insert(context: ProjectContext): void {
    this.store.execute(
      "INSERT INTO project_contexts (project_id,content,version,updated_by,updated_at) VALUES (?,?,?,?,?)",
      [
        context.projectId,
        context.content,
        context.version,
        context.updatedBy,
        context.updatedAt,
      ],
    );
  }
  update(context: ProjectContext, expectedVersion: number): boolean {
    return (
      this.store.execute(
        "UPDATE project_contexts SET content = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE project_id = ? AND version = ?",
        [
          context.content,
          context.updatedBy,
          context.updatedAt,
          context.projectId,
          expectedVersion,
        ],
      ) === 1
    );
  }
}
