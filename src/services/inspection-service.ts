import type { ProjectAccess } from "../domain/access";
import type { InspectionInput, PageInput } from "../domain/contracts";
import { AppError } from "../domain/errors";
import { page } from "../domain/pagination";
import type { InspectionRepository } from "../repositories/inspection-repository";
import type { UnitOfWork } from "../repositories/sqlite-store";
import type { Clock } from "./activity-service";

export class InspectionService {
  constructor(
    private readonly repository: InspectionRepository,
    private readonly transaction: UnitOfWork,
    private readonly now: Clock,
    private readonly modelId: string,
    private readonly access: ProjectAccess,
  ) {}
  projects(input: PageInput) {
    return page(
      this.repository.projects(input, this.access.projects),
      input.limit ?? 50,
      (item) => item.projectId,
    );
  }
  stats(input: InspectionInput) {
    if (input.projectId !== undefined)
      this.access.require(input.projectId, "read");
    else if (this.access.projects !== "all")
      throw new AppError(
        "FORBIDDEN",
        "This credential is limited to specific projects; specify projectId.",
        403,
      );
    return this.transaction.run(() =>
      this.repository.stats(input, this.now(), this.modelId),
    );
  }
}
