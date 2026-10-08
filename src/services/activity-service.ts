import type { ProjectAccess } from "../domain/access";
import type { ActivityEvent, ActivityInput } from "../domain/contracts";
import { newId } from "../domain/ids";
import type { ActivityRepository } from "../repositories/activity-repository";

export type Clock = () => number;
export class ActivityService {
  constructor(
    private readonly repository: ActivityRepository,
    private readonly now: Clock,
    private readonly access: ProjectAccess,
  ) {}
  append(input: Omit<ActivityEvent, "id" | "createdAt">): void {
    this.repository.insert({
      ...input,
      id: newId("evt"),
      createdAt: this.now(),
    });
  }
  recent(input: ActivityInput) {
    this.access.require(input.projectId, "read");
    return { items: this.repository.recent(input) };
  }
}
