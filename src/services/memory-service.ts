import type {
  Memory,
  RememberInput,
  SearchInput,
  MemoryGetInput,
  MemoryUpdateInput,
  MemoryDeleteInput,
  MemoryDeleted,
} from "../domain/contracts";
import { AppError } from "../domain/errors";
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
      const now = this.now();
      const memory: Memory = {
        ...input,
        id: `mem_${Bun.randomUUIDv7()}`,
        importance: input.importance ?? null,
        metadata: input.metadata ?? null,
        createdAt: now,
        version: 1,
        updatedBy: input.agentId,
        updatedAt: now,
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
  get(input: MemoryGetInput): Memory {
    const memory = this.repository.get(input);
    if (!memory)
      throw new AppError(
        "MEMORY_NOT_FOUND",
        "Memory does not exist in this project.",
        404,
      );
    return memory;
  }
  private versionConflict(memory: Memory, expectedVersion: number): AppError {
    return new AppError(
      "MEMORY_VERSION_CONFLICT",
      "Memory changed. Read the latest memory before retrying.",
      409,
      {
        memoryId: memory.id,
        expectedVersion,
        actualVersion: memory.version,
      },
    );
  }
  update(input: MemoryUpdateInput): Memory {
    return this.transaction.run(() => {
      const current = this.get(input);
      if (current.version !== input.expectedVersion)
        throw this.versionConflict(current, input.expectedVersion);
      const memory: Memory = {
        ...current,
        type: input.type ?? current.type,
        content: input.content ?? current.content,
        importance:
          input.importance === undefined
            ? current.importance
            : input.importance,
        metadata:
          input.metadata === undefined ? current.metadata : input.metadata,
        version: current.version + 1,
        updatedBy: input.agentId,
        updatedAt: this.now(),
      };
      if (!this.repository.update(memory, input.expectedVersion))
        throw this.versionConflict(current, input.expectedVersion);
      this.activity.append({
        projectId: memory.projectId,
        agentId: input.agentId,
        type: "memory.updated",
        resource: null,
        message: null,
        metadata: {
          memoryId: memory.id,
          previousVersion: current.version,
          version: memory.version,
        },
      });
      return memory;
    });
  }
  delete(input: MemoryDeleteInput): MemoryDeleted {
    return this.transaction.run(() => {
      const current = this.get(input);
      if (current.version !== input.expectedVersion)
        throw this.versionConflict(current, input.expectedVersion);
      if (!this.repository.delete(input))
        throw this.versionConflict(current, input.expectedVersion);
      this.activity.append({
        projectId: current.projectId,
        agentId: input.agentId,
        type: "memory.deleted",
        resource: null,
        message: null,
        metadata: { memoryId: current.id, version: current.version },
      });
      return { deleted: true, memoryId: current.id };
    });
  }
}
