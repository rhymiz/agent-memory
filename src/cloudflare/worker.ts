import {
  getOAuthApi,
  OAuthProvider,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { createAdminRouter } from "../api/admin-router";
import {
  createAdminGateway,
  createApiGateway,
  failureResponse,
} from "../api/gateway";
import { createHttpHandler, type RequestPolicy } from "../api/handler";
import { authorizePath, createSignIn, memberTokenProps } from "../api/sign-in";
import { createApplication } from "../application";
import { credentialMigrations, memoryMigrations, migrate } from "../db/migrate";
import { oauthScopes, ProjectAccess, type Grant } from "../domain/access";
import { principal, type Principal } from "../domain/credentials";
import { AppError } from "../domain/errors";
import type { Member, VerifiedIdentity } from "../domain/members";
import { SqliteCredentialRepository } from "../repositories/credential-repository";
import { SqliteMemberRepository } from "../repositories/member-repository";
import type { ClaimPolicy } from "../services/claim-service";
import { CredentialService } from "../services/credential-service";
import { MemberService } from "../services/member-service";
import { DurableObjectSqliteStore } from "./durable-object-store";
import { GitHubIdentityProvider } from "./github-identity";
import { WorkersAiEmbeddingModel } from "./workers-ai-model";

// Memories indexed per alarm, keeping each run well inside its limits.
const reindexBatch = 50;
const registryName = "registry";
// Every API path the application serves; anything else is sign-in or admin.
const apiRoutes = [
  "/mcp",
  "/memories",
  "/claims",
  "/projects",
  "/stats",
  "/health",
];

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

// Every API key and member, across accounts. Key hashes only; revoking a key
// or member applies to the next request.
export class CredentialRegistry extends DurableObject<Env> {
  private readonly credentials: CredentialService;
  private readonly members: MemberService;
  private readonly admin: (request: Request) => Promise<Response>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const store = new DurableObjectSqliteStore(ctx.storage);
    this.credentials = new CredentialService(
      new SqliteCredentialRepository(store),
      store,
      Date.now,
    );
    this.members = new MemberService(
      new SqliteMemberRepository(store),
      store,
      Date.now,
    );
    this.admin = createAdminRouter(this.credentials, this.members);
    void ctx.blockConcurrencyWhile(async () => {
      migrate(store, credentialMigrations, Date.now);
    });
  }

  authenticate(token: string): Promise<Principal | null> {
    return this.credentials.authenticate(token);
  }

  signIn(identity: VerifiedIdentity): Member | null {
    return this.members.signIn(identity);
  }

  memberPrincipal(memberId: string, scopes: string[]): Principal | null {
    return this.members.principal(memberId, scopes);
  }

  administer(request: Request): Promise<Response> {
    return this.admin(request);
  }
}

const registry = (env: Env) => env.CREDENTIALS.getByName(registryName);

// Props the OAuth provider passes to API requests: a signed-in member's grant
// reference, or an API key's principal resolved as an external token.
const apiProps = z.union([
  memberTokenProps,
  z.strictObject({ kind: z.literal("api-key"), principal }),
]);

async function serveApi(
  request: Request,
  env: Env,
  props: unknown,
): Promise<Response> {
  const parsed = apiProps.safeParse(props);
  const caller = !parsed.success
    ? null
    : parsed.data.kind === "api-key"
      ? parsed.data.principal
      : await registry(env).memberPrincipal(
          parsed.data.memberId,
          parsed.data.scopes,
        );
  if (caller === null)
    return failureResponse(
      new AppError("UNAUTHORIZED", "A valid credential is required.", 401),
    );
  return createApiGateway({
    admit: async (current) =>
      (await env.KEY_RATE_LIMIT.limit({ key: current.credentialId })).success,
    forward: (current, forwarded) =>
      env.ACCOUNTS.getByName(current.accountId).handle(
        forwarded,
        current.grant,
      ),
  })(request, caller);
}

function oauthOptions(origin: string): OAuthProviderOptions<Env> {
  return {
    apiRoute: apiRoutes,
    apiHandler: {
      fetch: (request, env, ctx) => serveApi(request, env, ctx.props),
    },
    defaultHandler: {
      fetch: async (request, env) => {
        if (new URL(request.url).pathname.startsWith("/admin/"))
          return createAdminGateway({
            adminToken: env.AGENT_MEMORY_ADMIN_TOKEN,
            administer: (forwarded) => registry(env).administer(forwarded),
          })(request);
        const signedIn = await createSignIn({
          flow: getOAuthApi(oauthOptions(origin), env),
          identity: new GitHubIdentityProvider({
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          }),
          member: (identity) => registry(env).signIn(identity),
        })(request);
        return (
          signedIn ??
          failureResponse(
            new AppError("NOT_FOUND", "Endpoint does not exist.", 404),
          )
        );
      },
    },
    authorizeEndpoint: authorizePath,
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: [...oauthScopes],
    requiredScopes: ["memory:read"],
    accessTokenTTL: 3600,
    resourceMetadata: { resource: origin, resource_name: "Agent Memory" },
    // API keys for headless clients: not OAuth tokens, resolved by the registry.
    resolveExternalToken: async ({ token, env }) => {
      const resolved = await registry(env).authenticate(token);
      return resolved === null
        ? null
        : { props: { kind: "api-key", principal: resolved }, audience: origin };
    },
  };
}

export default {
  // The service answers only on its custom domain, so the request origin is
  // the protected resource and issuer; no hostname is committed.
  fetch(request, env, ctx) {
    return new OAuthProvider(oauthOptions(new URL(request.url).origin)).fetch(
      request,
      env,
      ctx,
    );
  },
} satisfies ExportedHandler<Env>;
