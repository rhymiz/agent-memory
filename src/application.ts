import type { SqliteStore } from "./repositories/sqlite-store";
import type { ProjectAccess } from "./domain/access";
import { SqliteActivityRepository } from "./repositories/activity-repository";
import { SqliteClaimRepository } from "./repositories/claim-repository";
import { SqliteContextRepository } from "./repositories/context-repository";
import { SqliteDecisionRepository } from "./repositories/decision-repository";
import { SqliteMemoryRepository } from "./repositories/memory-repository";
import { SqliteInspectionRepository } from "./repositories/inspection-repository";
import { InspectionService } from "./services/inspection-service";
import { ActivityService, type Clock } from "./services/activity-service";
import { ClaimService, type ClaimPolicy } from "./services/claim-service";
import { ContextService } from "./services/context-service";
import { DecisionService } from "./services/decision-service";
import { MemoryService } from "./services/memory-service";
import { BriefingService } from "./services/briefing-service";
import type { ActivityInput } from "./domain/contracts";
import packageInfo from "../package.json";
import type { EmbeddingModel } from "./domain/embedding";

export function createApplication(
  store: SqliteStore,
  policy: ClaimPolicy,
  model: EmbeddingModel,
  access: ProjectAccess,
  now: Clock = Date.now,
) {
  const activity = new ActivityService(
    new SqliteActivityRepository(store),
    now,
    access,
  );
  const claims = new ClaimService(
    new SqliteClaimRepository(store),
    store,
    activity,
    now,
    policy,
    access,
  );
  const memories = new MemoryService(
    new SqliteMemoryRepository(store),
    store,
    activity,
    now,
    model,
    access,
  );
  const context = new ContextService(
    new SqliteContextRepository(store),
    store,
    activity,
    now,
    access,
  );
  const decisions = new DecisionService(
    new SqliteDecisionRepository(store),
    store,
    activity,
    now,
    access,
  );
  return {
    inspection: new InspectionService(
      new SqliteInspectionRepository(store),
      store,
      now,
      model.id,
      access,
    ),
    memories,
    claims,
    context,
    decisions,
    briefing: new BriefingService(
      memories,
      context,
      claims,
      decisions,
      activity,
    ),
    activity: {
      recent(input: ActivityInput) {
        access.require(input.projectId, "read");
        claims.expire(input.projectId);
        return activity.recent(input);
      },
    },
    health() {
      store.health();
      return { status: "ok", database: "ok", version: packageInfo.version };
    },
  };
}
export type Application = ReturnType<typeof createApplication>;
