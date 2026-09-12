import type {
  Memory,
  RememberInput,
  SearchInput,
  MemoryGetInput,
  MemoryUpdateInput,
  MemoryDeleteInput,
  MemoryDeleted,
  CompactSearchInput,
  CompactSearchResult,
} from "../domain/contracts";
import { AppError } from "../domain/errors";
import type { MemoryRepository } from "../repositories/memory-repository";
import type { UnitOfWork } from "../repositories/sqlite-store";
import { ActivityService, type Clock } from "./activity-service";
import { cosine, normalized, type EmbeddingModel } from "../domain/embedding";
import { projectCollection, projectExcerpt } from "../domain/projections";

export class MemoryService {
  private readonly pending = new Set<Promise<unknown>>();
  constructor(
    private readonly repository: MemoryRepository,
    private readonly transaction: UnitOfWork,
    private readonly activity: ActivityService,
    private readonly now: Clock,
    private readonly model: EmbeddingModel,
  ) {}
  private track<T>(operation: () => Promise<T>): Promise<T> {
    const task = operation();
    this.pending.add(task);
    const remove = () => {
      this.pending.delete(task);
    };
    void task.then(remove, remove);
    return task;
  }
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
  private async embed(content: string): Promise<Float32Array[]> {
    const vectors = await this.model.embedDocument(content);
    if (!vectors.length)
      throw new Error("Model returned no document embeddings");
    return vectors.map((vector) => normalized(vector, this.model.dimensions));
  }
  async reindex(): Promise<number> {
    let count = 0;
    while (true) {
      const batch = this.repository.unindexed(this.model.id, 50);
      if (!batch.length) return count;
      for (const memory of batch) {
        const vectors = await this.embed(memory.content);
        this.transaction.run(() => {
          const current = this.repository.get({
            projectId: memory.projectId,
            memoryId: memory.id,
          });
          if (current?.version !== memory.version) return;
          this.repository.replaceEmbeddings(current, this.model.id, vectors);
          count++;
        });
      }
    }
  }
  remember(input: RememberInput): Promise<Memory> {
    return this.track(() => this.createIndexed(input));
  }
  private async createIndexed(input: RememberInput): Promise<Memory> {
    const vectors = await this.embed(input.content);
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
      this.repository.replaceEmbeddings(memory, this.model.id, vectors);
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
  search(input: SearchInput): Promise<{ items: Memory[] }> {
    return this.track(() => this.retrieve(input));
  }
  async searchCompact(input: CompactSearchInput): Promise<CompactSearchResult> {
    const limit = input.limit ?? 8;
    const { items } = await this.search({
      projectId: input.projectId,
      query: input.query,
      limit: limit + 1,
    });
    return projectCollection(
      items,
      limit,
      input.maxBytes ?? 12_000,
      (memory, bytes) =>
        projectExcerpt(memory.content, input.query, bytes, (excerpt) => ({
          id: memory.id,
          type: memory.type,
          version: memory.version,
          updatedAt: memory.updatedAt,
          excerpt,
        })),
    );
  }
  private async retrieve(input: SearchInput): Promise<{ items: Memory[] }> {
    if (!/[\p{L}\p{N}]/u.test(input.query)) return { items: [] };
    const query = normalized(
      await this.model.embedQuery(input.query),
      this.model.dimensions,
    );
    // Read both retrieval views after inference, in one synchronous database snapshot.
    return this.transaction.run(() => {
      const limit = input.limit ?? 10;
      const candidates = Math.max(50, limit * 4);
      const lexical = this.repository.search({ ...input, limit: candidates });
      const semantic = new Map<string, { memory: Memory; score: number }>();
      for (const { memory, vector } of this.repository.embeddings(
        input.projectId,
        this.model.id,
        this.model.dimensions,
      )) {
        const score = cosine(query, vector);
        if (score < 0.3) continue;
        if (score > (semantic.get(memory.id)?.score ?? -Infinity))
          semantic.set(memory.id, { memory, score });
      }
      const ranked = [...semantic.values()]
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.memory.createdAt - a.memory.createdAt ||
            b.memory.id.localeCompare(a.memory.id),
        )
        .slice(0, candidates);
      // Reciprocal rank fusion preserves exact-term hits and semantic paraphrases.
      const fused = new Map<string, { memory: Memory; score: number }>();
      for (const list of [lexical, ranked.map((item) => item.memory)]) {
        list.forEach((memory, index) => {
          const current = fused.get(memory.id);
          fused.set(memory.id, {
            memory,
            score: (current?.score ?? 0) + 1 / (60 + index + 1),
          });
        });
      }
      return {
        items: [...fused.values()]
          .sort(
            (a, b) =>
              b.score - a.score ||
              b.memory.createdAt - a.memory.createdAt ||
              b.memory.id.localeCompare(a.memory.id),
          )
          .slice(0, limit)
          .map((item) => item.memory),
      };
    });
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
  update(input: MemoryUpdateInput): Promise<Memory> {
    return this.track(() => this.updateIndexed(input));
  }
  private async updateIndexed(input: MemoryUpdateInput): Promise<Memory> {
    const observed = this.get(input);
    if (observed.version !== input.expectedVersion)
      throw this.versionConflict(observed, input.expectedVersion);
    const vectors = await this.embed(input.content ?? observed.content);
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
      this.repository.replaceEmbeddings(memory, this.model.id, vectors);
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
