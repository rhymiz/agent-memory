import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createAdminRouter } from "../src/api/admin-router";
import {
  bearerToken,
  createAdminGateway,
  createApiGateway,
  failureResponse,
} from "../src/api/gateway";
import { createHttpHandler } from "../src/api/handler";
import { createApplication } from "../src/application";
import { BunSqliteStore } from "../src/db/bun-sqlite-store";
import { openDatabase } from "../src/db/database";
import { credentialMigrations, migrate } from "../src/db/migrate";
import {
  ProjectAccess,
  type Grant,
  type OAuthScope,
} from "../src/domain/access";
import {
  issuedKey,
  type IssuedKey,
  type Principal,
} from "../src/domain/credentials";
import { AppError } from "../src/domain/errors";
import { member, type Member } from "../src/domain/members";
import { SqliteCredentialRepository } from "../src/repositories/credential-repository";
import { SqliteMemberRepository } from "../src/repositories/member-repository";
import { CredentialService } from "../src/services/credential-service";
import { MemberService } from "../src/services/member-service";
import { TestEmbeddingModel } from "./helpers";

export const adminToken = "test-admin-token";

// The hosted service over Bun SQLite: the credential, member, gateway and
// application code the Worker composes, with one database per account. The
// OAuth provider library needs the Workers runtime, so a token table stands in
// for its OAuth token validation; API keys and member grants use real services.
export function hostedFixture() {
  const directory = mkdtempSync(join(tmpdir(), "agent-memory-hosted-"));
  let time = 1_789_063_200_000;
  const now = () => time;
  const credentialDb = new Database(join(directory, "credentials.sqlite"), {
    create: true,
    strict: true,
  });
  const credentialStore = new BunSqliteStore(credentialDb);
  migrate(credentialStore, credentialMigrations, now);
  const credentials = new CredentialService(
    new SqliteCredentialRepository(credentialStore),
    credentialStore,
    now,
  );
  const members = new MemberService(
    new SqliteMemberRepository(credentialStore),
    credentialStore,
    now,
  );
  // OAuth access tokens issued by the stand-in provider, mapped to grant props.
  const oauthTokens = new Map<
    string,
    { memberId: string; scopes: OAuthScope[] }
  >();
  const model = new TestEmbeddingModel();
  const accounts = new Map<string, Database>();
  const account = (accountId: string) => {
    let db = accounts.get(accountId);
    if (!db) {
      db = openDatabase(join(directory, `${accountId}.sqlite`));
      accounts.set(accountId, db);
    }
    return new BunSqliteStore(db);
  };
  let admitted = true;
  const admin = createAdminGateway({
    adminToken,
    administer: createAdminRouter(credentials, members),
  });
  const api = createApiGateway({
    admit: async () => admitted,
    forward: (principal, request) =>
      createHttpHandler(
        createApplication(
          account(principal.accountId),
          { defaultTtlSeconds: 300, maxTtlSeconds: 3600 },
          model,
          new ProjectAccess(principal.grant),
          now,
        ),
        () => {},
      ).fetch(request),
  });
  const authenticate = async (token: string): Promise<Principal | null> => {
    const oauth = oauthTokens.get(token);
    return oauth
      ? members.principal(oauth.memberId, oauth.scopes)
      : credentials.authenticate(token);
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname.startsWith("/admin/"))
        return admin(request);
      const token = bearerToken(request);
      const principal = token === null ? null : await authenticate(token);
      return principal === null
        ? failureResponse(
            new AppError(
              "UNAUTHORIZED",
              "A valid credential is required.",
              401,
            ),
          )
        : api(request, principal);
    },
  });
  const baseUrl = server.url.href;
  return {
    baseUrl,
    credentials,
    members,
    addMember(
      accountId: string,
      login: string,
      subject: string,
      grant: Grant,
    ): Member {
      return member.parse(
        members.add({ accountId, provider: "github", subject, login, grant }),
      );
    },
    // What a completed OAuth sign-in yields: a bearer token for the member.
    signInToken(memberId: string, scopes: OAuthScope[]): string {
      const token = `oauth-${memberId}-${oauthTokens.size}`;
      oauthTokens.set(token, { memberId, scopes });
      return token;
    },
    advance(ms: number) {
      time += ms;
    },
    get time() {
      return time;
    },
    rateLimit(exceeded: boolean) {
      admitted = !exceeded;
    },
    async issue(
      accountId: string,
      grant: Grant,
      expiresAt?: number,
    ): Promise<IssuedKey> {
      return issuedKey.parse(
        await credentials.issue({
          accountId,
          name: `${accountId} key`,
          grant,
          ...(expiresAt === undefined ? {} : { expiresAt }),
        }),
      );
    },
    request(path: string, token: string | null, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (token !== null) headers.set("Authorization", `Bearer ${token}`);
      if (init.body !== undefined)
        headers.set("Content-Type", "application/json");
      return fetch(new URL(path, baseUrl), { ...init, headers });
    },
    async close() {
      await server.stop(true);
      credentialDb.close(true);
      for (const db of accounts.values()) db.close(true);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
export type HostedFixture = ReturnType<typeof hostedFixture>;
