import type { ActivityEvent, ActivityInput } from "../domain/contracts";
import type { ActivityRepository } from "../repositories/activity-repository";

export type Clock = () => number;
export class ActivityService {
  constructor(
    private readonly repository: ActivityRepository,
    private readonly now: Clock,
  ) {}
  append(input: Omit<ActivityEvent, "id" | "createdAt">): void {
    this.repository.insert({
      ...input,
      id: `evt_${Bun.randomUUIDv7()}`,
      createdAt: this.now(),
    });
  }
  recent(input: ActivityInput) {
    return { items: this.repository.recent(input) };
  }
}
