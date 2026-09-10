import type { Memory, RememberInput, SearchInput } from "../domain/contracts";
import type { MemoryRepository } from "../repositories/memory-repository";
import type { UnitOfWork } from "../repositories/sqlite-store";
import { ActivityService, type Clock } from "./activity-service";

export class MemoryService {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly transaction: UnitOfWork,
    private readonly activity: ActivityService,
    private readonly now: Clock,
  ) {}
  remember(input: RememberInput): Memory {
    return this.transaction.run(() => {
      const memory: Memory = {
        ...input,
        id: `mem_${Bun.randomUUIDv7()}`,
        importance: input.importance ?? null,
        metadata: input.metadata ?? null,
        createdAt: this.now(),
      };
      this.repository.insert(memory);
      this.activity.append({
        projectId: input.projectId,
        agentId: input.agentId,
        type: "memory.created",
        resource: null,
        message: null,
        metadata: { memoryId: memory.id, memoryType: memory.type },
      });
      return memory;
    });
  }
  search(input: SearchInput) {
    return { items: this.repository.search(input) };
  }
}
