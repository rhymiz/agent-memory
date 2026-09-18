import type {
  AcquireInput,
  Claim,
  ClaimsInput,
  ReleaseInput,
  RenewInput,
  RenewClaimsInput,
  ClaimsRenewed,
  ClaimGranted,
  AcquireClaimsInput,
  ClaimsGranted,
  ReleaseClaimsInput,
  ClaimsReleased,
  ClaimAdvisory,
} from "../domain/contracts";
import { AppError } from "../domain/errors";
import { normalizeResource } from "../domain/resource";
import { scheduleLease } from "../domain/lease";
import type { ClaimRepository } from "../repositories/claim-repository";
import type { UnitOfWork } from "../repositories/sqlite-store";
import { ActivityService, type Clock } from "./activity-service";

const largeClaimSetThreshold = 100;

export interface ClaimPolicy {
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
}
export class ClaimService {
  constructor(
    private readonly repository: ClaimRepository,
    private readonly transaction: UnitOfWork,
    private readonly activity: ActivityService,
    private readonly now: Clock,
    private readonly policy: ClaimPolicy,
  ) {}
  private ttl(value?: number): number {
    const ttl = value ?? this.policy.defaultTtlSeconds;
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < 1 ||
      ttl > this.policy.maxTtlSeconds
    ) {
      throw new AppError(
        "INVALID_REQUEST",
        `ttlSeconds must be between 1 and ${this.policy.maxTtlSeconds}.`,
      );
    }
    return ttl * 1000;
  }
  private event(
    claim: Claim,
    type:
      "claim.acquired" | "claim.released" | "claim.renewed" | "claim.expired",
  ): void {
    this.activity.append({
      projectId: claim.projectId,
      agentId: claim.agentId,
      type,
      resource: claim.resource,
      message: claim.intent,
      metadata: { claimId: claim.id, expiresAt: claim.expiresAt },
    });
  }
  private removeExpired(
    projectId: string,
    now: number,
    resource?: string,
  ): void {
    for (const claim of this.repository.expired(projectId, now, resource)) {
      this.repository.delete(claim.id);
      this.event(claim, "claim.expired");
    }
  }
  expire(projectId: string): void {
    this.transaction.run(() => this.removeExpired(projectId, this.now()));
  }
  acquire(input: AcquireInput): ClaimGranted {
    const { resource, ...scope } = input;
    const acquired = this.acquireMany({ ...scope, resources: [resource] });
    return {
      granted: true,
      claim: acquired.claims[0]!,
      schedule: acquired.schedule,
      advisories: acquired.advisories,
    };
  }
  acquireMany(input: AcquireClaimsInput): ClaimsGranted {
    const resources = input.resources.map(normalizeResource).sort();
    if (new Set(resources).size !== resources.length)
      throw new AppError(
        "INVALID_REQUEST",
        "Resources must be unique after normalization.",
      );
    const ttl = this.ttl(input.ttlSeconds);
    return this.transaction.run(() => {
      const now = this.now();
      for (const resource of resources) {
        this.removeExpired(input.projectId, now, resource);
        const current = this.repository.find(input.projectId, resource);
        if (current) {
          throw new AppError(
            "CLAIM_CONFLICT",
            "Resource is already claimed.",
            409,
            {
              claimId: current.id,
              agentId: current.agentId,
              resource: current.resource,
              intent: current.intent,
              expiresAt: current.expiresAt,
            },
          );
        }
      }
      const claims: Claim[] = resources.map((resource) => ({
        id: `clm_${Bun.randomUUIDv7()}`,
        projectId: input.projectId,
        agentId: input.agentId,
        resource,
        intent: input.intent ?? null,
        createdAt: now,
        expiresAt: now + ttl,
      }));
      for (const claim of claims) this.repository.insert(claim);
      this.batchEvent(claims, "claim.acquired");
      return {
        granted: true,
        claims,
        schedule: scheduleLease(now + ttl, ttl),
        advisories: this.advisories(claims, now),
      };
    });
  }
  private advisories(claims: Claim[], now: number): ClaimAdvisory[] {
    const first = claims[0]!;
    const activeClaimCount = this.repository
      .list({ projectId: first.projectId })
      .filter(
        (claim) => claim.agentId === first.agentId && claim.expiresAt > now,
      ).length;
    const advisories: ClaimAdvisory[] = [];
    if (activeClaimCount > largeClaimSetThreshold) {
      advisories.push({
        kind: "large-claim-set",
        message: `This agent now owns ${activeClaimCount} active resources in this project. Check that they match the current phase's intended writes and release unused claims.`,
        activeClaimCount,
        threshold: largeClaimSetThreshold,
      });
    }
    const generated = claims
      .map((claim) => claim.resource)
      .filter((resource) => {
        const file = resource.startsWith("file:");
        if (!file && !resource.startsWith("directory:")) return false;
        const path = resource.slice(resource.indexOf(":") + 1).split("/");
        return (file ? path.slice(0, -1) : path).includes("generated");
      });
    if (generated.length) {
      advisories.push({
        kind: "generated-resources",
        message:
          "These paths contain a generated directory. Keep their claims when shared outputs will be modified; use isolated output for disposable build artifacts where possible.",
        resources: generated,
      });
    }
    return advisories;
  }
  private batchEvent(
    claims: Claim[],
    type: "claim.acquired" | "claim.released",
  ): void {
    const first = claims[0]!;
    if (claims.length === 1) return this.event(first, type);
    this.activity.append({
      projectId: first.projectId,
      agentId: first.agentId,
      type,
      resource: null,
      message: `${type === "claim.acquired" ? "Acquired" : "Released"} ${claims.length} resource leases.`,
      metadata: {
        claimCount: claims.length,
        claims: claims.map((claim) => ({
          claimId: claim.id,
          resource: claim.resource,
          expiresAt: claim.expiresAt,
        })),
      },
    });
  }
  private owned(input: ReleaseInput, now: number, projectId?: string): Claim {
    const claim = this.repository.get(input.claimId);
    if (!claim || (projectId !== undefined && claim.projectId !== projectId))
      throw new AppError(
        "CLAIM_NOT_FOUND",
        "Claim does not exist or has already been removed.",
        404,
        { claimId: input.claimId },
      );
    if (claim.agentId !== input.agentId)
      throw new AppError(
        "CLAIM_NOT_OWNER",
        "Only the claim owner may change it.",
        403,
        { claimId: input.claimId },
      );
    if (claim.expiresAt <= now)
      throw new AppError(
        "CLAIM_EXPIRED",
        "Claim has expired; acquire a new claim.",
        409,
        {
          claimId: claim.id,
          resource: claim.resource,
          expiresAt: claim.expiresAt,
        },
      );
    return claim;
  }
  release(input: ReleaseInput): { released: true; claimId: string } {
    return this.transaction.run(() => {
      const claim = this.owned(input, this.now());
      this.repository.delete(claim.id);
      this.event(claim, "claim.released");
      return { released: true, claimId: claim.id };
    });
  }
  releaseMany(input: ReleaseClaimsInput): ClaimsReleased {
    return this.transaction.run(() => {
      const now = this.now();
      const claims = input.claimIds.map((claimId) =>
        this.owned({ claimId, agentId: input.agentId }, now, input.projectId),
      );
      for (const claim of claims) this.repository.delete(claim.id);
      this.batchEvent(claims, "claim.released");
      return { released: true, claimIds: claims.map((claim) => claim.id) };
    });
  }
  renew(input: RenewInput): Claim {
    const ttl = this.ttl(input.ttlSeconds);
    return this.transaction.run(() => {
      const now = this.now();
      const claim = this.owned(input, now);
      return this.renewOwned([claim], ttl, now).claims[0]!;
    });
  }
  renewMany(input: RenewClaimsInput): ClaimsRenewed {
    const ttl = this.ttl(input.ttlSeconds);
    return this.transaction.run(() => {
      const now = this.now();
      // Validate every requested lease before changing any of them. Missing,
      // expired, foreign-project and non-owned claims fail the entire batch.
      const claims = input.claimIds.map((claimId) =>
        this.owned({ claimId, agentId: input.agentId }, now, input.projectId),
      );
      return this.renewOwned(claims, ttl, now).summary;
    });
  }
  private renewOwned(
    claims: Claim[],
    ttl: number,
    now: number,
  ): { claims: Claim[]; summary: ClaimsRenewed } {
    const earliest = Math.min(...claims.map((claim) => claim.expiresAt));
    const due = now >= earliest - ttl / 2;
    let renewedCount = 0;
    const renewed = claims.map((claim) => {
      const expiresAt = due
        ? Math.max(claim.expiresAt, now + ttl)
        : claim.expiresAt;
      if (expiresAt === claim.expiresAt) return claim;
      this.repository.renew(claim.id, expiresAt);
      renewedCount++;
      return { ...claim, expiresAt };
    });
    const expiresAt = Math.min(...renewed.map((claim) => claim.expiresAt));
    const summary: ClaimsRenewed = {
      claimCount: claims.length,
      renewedCount,
      ...scheduleLease(expiresAt, ttl),
    };
    if (renewedCount > 0) {
      if (renewed.length === 1) this.event(renewed[0]!, "claim.renewed");
      else
        this.activity.append({
          projectId: renewed[0]!.projectId,
          agentId: renewed[0]!.agentId,
          type: "claim.renewed",
          resource: null,
          message: `Renewed ${renewedCount} resource leases.`,
          metadata: summary,
        });
    }
    return { claims: renewed, summary };
  }
  list(input: ClaimsInput) {
    const resource =
      input.resource === undefined
        ? undefined
        : normalizeResource(input.resource);
    return this.transaction.run(() => {
      this.removeExpired(input.projectId, this.now(), resource);
      return { items: this.repository.list({ ...input, resource }) };
    });
  }
}
