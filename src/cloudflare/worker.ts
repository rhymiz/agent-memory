import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { createAdminRouter } from "../api/admin-router";
import { createGateway } from "../api/gateway";
import { createHttpHandler, type RequestPolicy } from "../api/handler";
import { createApplication } from "../application";
import { credentialMigrations, memoryMigrations, migrate } from "../db/migrate";
import { ProjectAccess, type Grant } from "../domain/access";
import type { Principal } from "../domain/credentials";
import { SqliteCredentialRepository } from "../repositories/credential-repository";
import type { ClaimPolicy } from "../services/claim-service";
import { CredentialService } from "../services/credential-service";
import { DurableObjectSqliteStore } from "./durable-object-store";
import { WorkersAiEmbeddingModel } from "./workers-ai-model";

// Memories indexed per alarm, keeping each run well inside its limits.
const reindexBatch = 50;
const registryName = "registry";

const claimPolicy = z
  .strictObject({
    defaultTtlSeconds: z.coerce.number().int().min(1).max(2_147_483_647),
    maxTtlSeconds: z.coerce.number().int().min(1).max(2_147_483_647),
  })
  .refine(
    (value) => value.defaultTtlSeconds <= value.maxTtlSeconds,
    "Default claim TTL must not exceed maximum TTL.",
  );

function readClaimPolicy(env: Env): ClaimPolicy {
  return claimPolicy.parse({
    defaultTtlSeconds: env.DEFAULT_CLAIM_TTL_SECONDS,
    maxTtlSeconds: env.MAX_CLAIM_TTL_SECONDS,
  });
}

// Requests reach an account only through the gateway, which authenticated them
// and supplies the grant; the Durable Object has no public address.
const forwarded: RequestPolicy = () => {};

// One account's projects: the same application the daemon serves, on Durable
// Object storage with Workers AI embeddings.
export class AccountMemory extends DurableObject<Env> {
  private readonly store: DurableObjectSqliteStore;
  private readonly model: WorkersAiEmbeddingModel;
  private readonly policy: ClaimPolicy;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new DurableObjectSqliteStore(ctx.storage);
    this.model = new WorkersAiEmbeddingModel(env.AI);
    this.policy = readClaimPolicy(env);
    void ctx.blockConcurrencyWhile(async () => {
      migrate(this.store, memoryMigrations, Date.now);
      // Index anything missing current-model vectors, without blocking requests.
      await ctx.storage.setAlarm(Date.now());
    });
  }

  private application(access: ProjectAccess) {
    return createApplication(this.store, this.policy, this.model, access);
  }

  // The MCP handler's close() aborts in-flight exchanges, so per-request
  // handlers are left to finish their responses rather than closed here.
  handle(request: Request, grant: Grant): Promise<Response> {
    return createHttpHandler(
      this.application(new ProjectAccess(grant)),
      forwarded,
    ).fetch(request);
  }

  override async alarm(): Promise<void> {
    const app = this.application(ProjectAccess.full);
    await app.memories.reindex(reindexBatch);
    const stats = app.inspection.stats({});
    if (stats.embeddings.memories < stats.memories.total)
      await this.ctx.storage.setAlarm(Date.now());
  }
}

// Every API key, across accounts. Hashes only; revocation is immediate.
export class CredentialRegistry extends DurableObject<Env> {
  private readonly credentials: CredentialService;
  private readonly admin: (request: Request) => Promise<Response>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const store = new DurableObjectSqliteStore(ctx.storage);
    this.credentials = new CredentialService(
      new SqliteCredentialRepository(store),
      store,
      Date.now,
    );
    this.admin = createAdminRouter(this.credentials);
    void ctx.blockConcurrencyWhile(async () => {
      migrate(store, credentialMigrations, Date.now);
    });
  }

  authenticate(token: string): Promise<Principal | null> {
    return this.credentials.authenticate(token);
  }

  administer(request: Request): Promise<Response> {
    return this.admin(request);
  }
}

export default {
  fetch(request, env) {
    const registry = env.CREDENTIALS.getByName(registryName);
    return createGateway({
      adminToken: env.AGENT_MEMORY_ADMIN_TOKEN,
      authenticate: (token) => registry.authenticate(token),
      admit: async (principal) =>
        (await env.KEY_RATE_LIMIT.limit({ key: principal.keyId })).success,
      administer: (forwardedRequest) => registry.administer(forwardedRequest),
      forward: (principal, forwardedRequest) =>
        env.ACCOUNTS.getByName(principal.accountId).handle(
          forwardedRequest,
          principal.grant,
        ),
    })(request);
  },
} satisfies ExportedHandler<Env>;
