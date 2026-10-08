import { z } from "zod";
import { accessLevel } from "../domain/access";
import { identifier } from "../domain/contracts";
import { member, type Member } from "../domain/members";
import { serializeProjects, storedProjects } from "./credential-repository";
import type { SqliteStore } from "./sqlite-store";

export interface MemberRepository {
  insert(member: Member): void;
  get(id: string): Member | null;
  active(provider: Member["provider"], subject: string): Member | null;
  list(accountId?: string): Member[];
  revoke(id: string, at: number): boolean;
}

const row = z
  .strictObject({
    id: identifier,
    accountId: identifier,
    provider: member.shape.provider,
    subject: member.shape.subject,
    login: member.shape.login,
    projects: storedProjects,
    access: accessLevel,
    createdAt: member.shape.createdAt,
    revokedAt: member.shape.revokedAt,
  })
  .transform(({ projects, access, ...rest }) => ({
    ...rest,
    grant: { projects, access },
  }));
const select = `SELECT id, account_id AS accountId, provider, subject, login,
  grant_projects AS projects, access, created_at AS createdAt, revoked_at AS revokedAt
  FROM members`;

export class SqliteMemberRepository implements MemberRepository {
  constructor(private readonly store: SqliteStore) {}
  insert(value: Member): void {
    this.store.execute(
      "INSERT INTO members (id,account_id,provider,subject,login,grant_projects,access,created_at,revoked_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        value.id,
        value.accountId,
        value.provider,
        value.subject,
        value.login,
        serializeProjects(value.grant.projects),
        value.grant.access,
        value.createdAt,
        value.revokedAt,
      ],
    );
  }
  get(id: string): Member | null {
    return this.store.get(row, `${select} WHERE id = ?`, [id]);
  }
  active(provider: Member["provider"], subject: string): Member | null {
    return this.store.get(
      row,
      `${select} WHERE provider = ? AND subject = ? AND revoked_at IS NULL`,
      [provider, subject],
    );
  }
  list(accountId?: string): Member[] {
    return this.store.all(
      row,
      `${select} WHERE (? IS NULL OR account_id = ?) ORDER BY account_id, created_at, id`,
      [accountId ?? null, accountId ?? null],
    );
  }
  revoke(id: string, at: number): boolean {
    return (
      this.store.execute(
        "UPDATE members SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        [at, id],
      ) === 1
    );
  }
}
