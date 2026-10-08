import { z } from "zod";
import { accessLevel, grant, type Grant } from "../domain/access";
import { identifier } from "../domain/contracts";
import { apiKey, type ApiKey } from "../domain/credentials";
import type { SqliteStore } from "./sqlite-store";

export interface StoredKey {
  key: ApiKey;
  secretHash: string;
}

export interface CredentialRepository {
  insert(key: ApiKey, secretHash: string): void;
  get(id: string): StoredKey | null;
  list(accountId?: string): ApiKey[];
  revoke(id: string, at: number): boolean;
  touch(id: string, at: number): void;
}

// Grants store "all" or a JSON array of project IDs; shared by keys and members.
export const storedProjects = z.preprocess(
  (value: unknown) => (value === "all" ? value : JSON.parse(String(value))),
  grant.shape.projects,
);
export function serializeProjects(projects: Grant["projects"]): string {
  return projects === "all" ? "all" : JSON.stringify(projects);
}
const row = z
  .strictObject({
    id: identifier,
    accountId: identifier,
    name: apiKey.shape.name,
    secretHash: z.string(),
    projects: storedProjects,
    access: accessLevel,
    createdAt: apiKey.shape.createdAt,
    expiresAt: apiKey.shape.expiresAt,
    revokedAt: apiKey.shape.revokedAt,
    lastUsedAt: apiKey.shape.lastUsedAt,
  })
  .transform(({ secretHash, projects, access, ...key }) => ({
    key: { ...key, grant: { projects, access } },
    secretHash,
  }));
const select = `SELECT id, account_id AS accountId, name, secret_hash AS secretHash,
  grant_projects AS projects, access, created_at AS createdAt, expires_at AS expiresAt,
  revoked_at AS revokedAt, last_used_at AS lastUsedAt FROM api_keys`;

export class SqliteCredentialRepository implements CredentialRepository {
  constructor(private readonly store: SqliteStore) {}
  insert(key: ApiKey, secretHash: string): void {
    this.store.execute(
      "INSERT INTO api_keys (id,account_id,name,secret_hash,grant_projects,access,created_at,expires_at,revoked_at,last_used_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        key.id,
        key.accountId,
        key.name,
        secretHash,
        serializeProjects(key.grant.projects),
        key.grant.access,
        key.createdAt,
        key.expiresAt,
        key.revokedAt,
        key.lastUsedAt,
      ],
    );
  }
  get(id: string): StoredKey | null {
    return this.store.get(row, `${select} WHERE id = ?`, [id]);
  }
  list(accountId?: string): ApiKey[] {
    return this.store
      .all(
        row,
        `${select} WHERE (? IS NULL OR account_id = ?) ORDER BY account_id, created_at, id`,
        [accountId ?? null, accountId ?? null],
      )
      .map((stored) => stored.key);
  }
  revoke(id: string, at: number): boolean {
    return (
      this.store.execute(
        "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        [at, id],
      ) === 1
    );
  }
  touch(id: string, at: number): void {
    this.store.execute("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [
      at,
      id,
    ]);
  }
}
