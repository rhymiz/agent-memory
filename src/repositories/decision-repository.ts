import {
  decisionSchema,
  type Decision,
  type DecisionsInput,
} from "../domain/contracts";
import { SqliteStore } from "./sqlite-store";

export interface DecisionRepository {
  get(projectId: string, id: string): Decision | null;
  insert(decision: Decision): void;
  supersede(id: string): boolean;
  list(input: DecisionsInput): Decision[];
}
const select =
  "SELECT id, project_id AS projectId, agent_id AS agentId, subject, decision, reasoning, status, supersedes_id AS supersedesId, created_at AS createdAt FROM decisions";
export class SqliteDecisionRepository implements DecisionRepository {
  constructor(private readonly store: SqliteStore) {}
  get(projectId: string, id: string) {
    return this.store.get(
      decisionSchema,
      `${select} WHERE project_id = ? AND id = ?`,
      [projectId, id],
    );
  }
  insert(decision: Decision): void {
    this.store.execute(
      "INSERT INTO decisions (id,project_id,agent_id,subject,decision,reasoning,status,supersedes_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        decision.id,
        decision.projectId,
        decision.agentId,
        decision.subject,
        decision.decision,
        decision.reasoning,
        decision.status,
        decision.supersedesId,
        decision.createdAt,
      ],
    );
  }
  supersede(id: string): boolean {
    return (
      this.store.execute(
        "UPDATE decisions SET status = 'superseded' WHERE id = ? AND status = 'active'",
        [id],
      ) === 1
    );
  }
  list(input: DecisionsInput) {
    if (input.query !== undefined) {
      const words = input.query.match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [];
      if (!words.length) return [];
      const match = words.map((word) => `"${word}"`).join(" OR ");
      return this.store.all(
        decisionSchema,
        `SELECT d.id, d.project_id AS projectId, d.agent_id AS agentId, d.subject,
          d.decision, d.reasoning, d.status, d.supersedes_id AS supersedesId, d.created_at AS createdAt
         FROM decisions_fts JOIN decisions d ON d.rowid = decisions_fts.rowid
         WHERE decisions_fts MATCH ? AND d.project_id = ? AND d.status = ?
         ORDER BY bm25(decisions_fts), d.created_at DESC, d.id DESC LIMIT ?`,
        [match, input.projectId, input.status ?? "active", input.limit ?? 50],
      );
    }
    return this.store.all(
      decisionSchema,
      `${select} WHERE project_id = ? AND (? IS NULL OR status = ?) ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      [
        input.projectId,
        input.status ?? null,
        input.status ?? null,
        input.limit ?? 50,
      ],
    );
  }
}
