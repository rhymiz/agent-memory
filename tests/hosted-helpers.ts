import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createAdminRouter } from "../src/api/admin-router";
import { createGateway } from "../src/api/gateway";
import { createHttpHandler } from "../src/api/handler";
import { createApplication } from "../src/application";
import { BunSqliteStore } from "../src/db/bun-sqlite-store";
import { openDatabase } from "../src/db/database";
import { credentialMigrations, migrate } from "../src/db/migrate";
import { ProjectAccess, type Grant } from "../src/domain/access";
import { issuedKey, type IssuedKey } from "../src/domain/credentials";
import { SqliteCredentialRepository } from "../src/repositories/credential-repository";
import { CredentialService } from "../src/services/credential-service";
import { TestEmbeddingModel } from "./helpers";

export const adminToken = "test-admin-token";

// The hosted gateway over Bun SQLite: the same credential, authorization and
// application code the Worker composes, with one database per account.
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
  const gateway = createGateway({
    adminToken,
    authenticate: (token) => credentials.authenticate(token),
    admit: async () => admitted,
    administer: createAdminRouter(credentials),
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
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: gateway });
  const baseUrl = server.url.href;
  return {
    baseUrl,
    credentials,
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
