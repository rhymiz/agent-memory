import type {
  Decision,
  DecisionInput,
  DecisionsInput,
} from "../domain/contracts";
import { AppError } from "../domain/errors";
import type { DecisionRepository } from "../repositories/decision-repository";
import type { UnitOfWork } from "../repositories/sqlite-store";
import { ActivityService, type Clock } from "./activity-service";

export class DecisionService {
  constructor(
    private readonly repository: DecisionRepository,
    private readonly transaction: UnitOfWork,
    private readonly activity: ActivityService,
    private readonly now: Clock,
  ) {}
  record(input: DecisionInput): Decision {
    return this.transaction.run(() => {
      const decision: Decision = {
        ...input,
        id: `dec_${Bun.randomUUIDv7()}`,
        reasoning: input.reasoning ?? null,
        status: "active",
        supersedesId: input.supersedesId ?? null,
        createdAt: this.now(),
      };
      if (input.supersedesId) {
        const previous = this.repository.get(
          input.projectId,
          input.supersedesId,
        );
        if (!previous)
          throw new AppError(
            "DECISION_NOT_FOUND",
            "The superseded decision must exist in this project.",
            404,
          );
        if (
          previous.status !== "active" ||
          !this.repository.supersede(previous.id)
        ) {
          throw new AppError(
            "DECISION_CONFLICT",
            "Decision has already been superseded. Read the current decisions before retrying.",
            409,
            { decisionId: previous.id },
          );
        }
        this.activity.append({
          projectId: input.projectId,
          agentId: input.agentId,
          type: "decision.superseded",
          resource: null,
          message: previous.subject,
          metadata: { decisionId: previous.id, supersededById: decision.id },
        });
      }
      this.repository.insert(decision);
      this.activity.append({
        projectId: input.projectId,
        agentId: input.agentId,
        type: "decision.created",
        resource: null,
        message: decision.subject,
        metadata: {
          decisionId: decision.id,
          supersedesId: decision.supersedesId,
        },
      });
      return decision;
    });
  }
  list(input: DecisionsInput) {
    return { items: this.repository.list(input) };
  }
}
