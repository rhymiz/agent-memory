import type {
  ContextUpdateInput,
  ProjectContext,
  ProjectInput,
} from "../domain/contracts";
import { AppError } from "../domain/errors";
import type { ContextRepository } from "../repositories/context-repository";
import type { UnitOfWork } from "../repositories/sqlite-store";
import { ActivityService, type Clock } from "./activity-service";

export class ContextService {
  constructor(
    private readonly repository: ContextRepository,
    private readonly transaction: UnitOfWork,
    private readonly activity: ActivityService,
    private readonly now: Clock,
  ) {}
  find(input: ProjectInput): ProjectContext | null {
    return this.repository.get(input.projectId);
  }
  get(input: ProjectInput): ProjectContext {
    const context = this.find(input);
    if (!context)
      throw new AppError(
        "PROJECT_NOT_FOUND",
        "Project context has not been created. Initialize it with expectedVersion: 0.",
        404,
      );
    return context;
  }
  update(input: ContextUpdateInput): ProjectContext {
    return this.transaction.run(() => {
      const current = this.repository.get(input.projectId);
      const actualVersion = current?.version ?? 0;
      const conflict = () =>
        new AppError(
          "CONTEXT_VERSION_CONFLICT",
          "Context changed. Read the latest context before retrying.",
          409,
          { expectedVersion: input.expectedVersion, actualVersion },
        );
      if (actualVersion !== input.expectedVersion) throw conflict();
      const context: ProjectContext = {
        projectId: input.projectId,
        content: input.content,
        version: actualVersion + 1,
        updatedBy: input.agentId,
        updatedAt: this.now(),
      };
      if (!current) this.repository.insert(context);
      else if (!this.repository.update(context, input.expectedVersion))
        throw conflict();
      this.activity.append({
        projectId: input.projectId,
        agentId: input.agentId,
        type: "context.updated",
        resource: null,
        message: null,
        metadata: { version: context.version, previousVersion: actualVersion },
      });
      return context;
    });
  }
}
