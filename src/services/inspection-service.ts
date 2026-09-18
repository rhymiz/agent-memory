import type { InspectionInput, PageInput } from "../domain/contracts";
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
  ) {}
  projects(input: PageInput) {
    return page(
      this.repository.projects(input),
      input.limit ?? 50,
      (item) => item.projectId,
    );
  }
  stats(input: InspectionInput) {
    return this.transaction.run(() =>
      this.repository.stats(input, this.now(), this.modelId),
    );
  }
}
