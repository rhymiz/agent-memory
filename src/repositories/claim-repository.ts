import { claimSchema, type Claim, type ClaimsInput } from "../domain/contracts";
import { SqliteStore } from "./sqlite-store";

export interface ClaimRepository {
  get(id: string): Claim | null;
  find(projectId: string, resource: string): Claim | null;
  list(input: ClaimsInput): Claim[];
  expired(projectId: string, now: number, resource?: string): Claim[];
  insert(claim: Claim): void;
  delete(id: string): void;
  renew(id: string, expiresAt: number): void;
}
const select =
  "SELECT id, project_id AS projectId, agent_id AS agentId, resource, intent, expires_at AS expiresAt, created_at AS createdAt FROM claims";

export class SqliteClaimRepository implements ClaimRepository {
  constructor(private readonly store: SqliteStore) {}
  get(id: string) {
    return this.store.get(claimSchema, `${select} WHERE id = ?`, [id]);
  }
  find(projectId: string, resource: string) {
    return this.store.get(
      claimSchema,
      `${select} WHERE project_id = ? AND resource = ?`,
      [projectId, resource],
    );
  }
  list(input: ClaimsInput) {
    return this.store.all(
      claimSchema,
      `${select} WHERE project_id = ? AND (? IS NULL OR resource = ?) ORDER BY resource`,
      [input.projectId, input.resource ?? null, input.resource ?? null],
    );
  }
  expired(projectId: string, now: number, resource?: string) {
    return this.store.all(
      claimSchema,
      `${select} WHERE project_id = ? AND expires_at <= ? AND (? IS NULL OR resource = ?) ORDER BY expires_at, rowid`,
      [projectId, now, resource ?? null, resource ?? null],
    );
  }
  insert(claim: Claim): void {
    this.store.execute(
      "INSERT INTO claims (id,project_id,agent_id,resource,intent,expires_at,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        claim.id,
        claim.projectId,
        claim.agentId,
        claim.resource,
        claim.intent,
        claim.expiresAt,
        claim.createdAt,
      ],
    );
  }
  delete(id: string): void {
    this.store.execute("DELETE FROM claims WHERE id = ?", [id]);
  }
  renew(id: string, expiresAt: number): void {
    this.store.execute("UPDATE claims SET expires_at = ? WHERE id = ?", [
      expiresAt,
      id,
    ]);
  }
}
