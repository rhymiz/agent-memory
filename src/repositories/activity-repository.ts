import {
  activitySchema,
  type ActivityEvent,
  type ActivityInput,
} from "../domain/contracts";
import { SqliteStore, storedMetadata } from "./sqlite-store";

export interface ActivityRepository {
  insert(event: ActivityEvent): void;
  recent(input: ActivityInput): ActivityEvent[];
}
const row = activitySchema.extend({ metadata: storedMetadata });
export class SqliteActivityRepository implements ActivityRepository {
  constructor(private readonly store: SqliteStore) {}
  insert(event: ActivityEvent): void {
    this.store.execute(
      "INSERT INTO activity (id,project_id,agent_id,type,resource,message,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        event.id,
        event.projectId,
        event.agentId,
        event.type,
        event.resource,
        event.message,
        event.metadata === null ? null : JSON.stringify(event.metadata),
        event.createdAt,
      ],
    );
  }
  recent(input: ActivityInput): ActivityEvent[] {
    return this.store.all(
      row,
      `SELECT id, project_id AS projectId, agent_id AS agentId, type, resource, message, metadata, created_at AS createdAt
      FROM activity WHERE project_id = ? AND (? IS NULL OR created_at >= ?)
      AND (? IS NULL OR agent_id = ?) AND (? IS NULL OR type = ?)
      AND (? IS NULL OR CASE WHEN type LIKE 'claim.%' THEN 'coordination' ELSE 'knowledge' END = ?)
      ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      [
        input.projectId,
        input.since ?? null,
        input.since ?? null,
        input.agentId ?? null,
        input.agentId ?? null,
        input.type ?? null,
        input.type ?? null,
        input.category ?? null,
        input.category ?? null,
        input.limit ?? 50,
      ],
    );
  }
}
