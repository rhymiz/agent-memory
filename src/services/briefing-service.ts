import {
  identifier,
  type ActivityEvent,
  type ActivityPreview,
  type BriefingInput,
  type BriefingSection,
  type ProjectBriefing,
} from "../domain/contracts";
import { AppError } from "../domain/errors";
import {
  jsonBytes,
  projectCollection,
  projectExcerpt,
} from "../domain/projections";
import type { ActivityService } from "./activity-service";
import type { ClaimService } from "./claim-service";
import type { ContextService } from "./context-service";
import type { DecisionService } from "./decision-service";
import type { MemoryService } from "./memory-service";

export class BriefingService {
  constructor(
    private readonly memories: MemoryService,
    private readonly context: ContextService,
    private readonly claims: ClaimService,
    private readonly decisions: DecisionService,
    private readonly activity: ActivityService,
  ) {}

  private change(event: ActivityEvent): {
    text: string;
    reference: ActivityPreview["reference"];
  } {
    const memoryId = identifier.safeParse(event.metadata?.memoryId);
    if (event.type.startsWith("memory.") && memoryId.success) {
      const reference: NonNullable<ActivityPreview["reference"]> = {
        kind: "memory",
        id: memoryId.data,
        version: null,
      };
      try {
        const memory = this.memories.get({
          projectId: event.projectId,
          memoryId: memoryId.data,
        });
        return {
          text: memory.content,
          reference: { ...reference, version: memory.version },
        };
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "MEMORY_NOT_FOUND")
          throw error;
        return { text: "Memory no longer exists.", reference };
      }
    }
    const decisionId = identifier.safeParse(event.metadata?.decisionId);
    if (event.type.startsWith("decision.") && decisionId.success) {
      return {
        text: event.message ?? event.type,
        reference: { kind: "decision", id: decisionId.data, version: null },
      };
    }
    if (event.type === "context.updated") {
      const context = this.context.find({ projectId: event.projectId });
      return {
        text: context?.content ?? "Project context has not been initialized.",
        reference: {
          kind: "context",
          id: event.projectId,
          version: context?.version ?? null,
        },
      };
    }
    return { text: event.message ?? event.type, reference: null };
  }

  async get(input: BriefingInput): Promise<ProjectBriefing> {
    const sections: BriefingSection[] = input.sections ?? [
      "context",
      "memories",
      "claims",
      "activity",
    ];
    const result: ProjectBriefing = { projectId: input.projectId };
    const overhead =
      jsonBytes(result) +
      sections.reduce((size, section) => size + jsonBytes(section) + 2, 0);
    const bytes = Math.floor(
      ((input.maxBytes ?? 20_000) - overhead) / sections.length,
    );
    if (sections.includes("memories")) {
      result.memories = await this.memories.searchCompact({
        projectId: input.projectId,
        query: input.query,
        limit: 5,
        maxBytes: bytes,
      });
    }
    if (sections.includes("context")) {
      const context = this.context.find(input);
      result.context = projectCollection(
        context ? [context] : [],
        1,
        bytes,
        (item, available) => {
          const { content, ...identity } = item;
          return projectExcerpt(content, input.query, available, (excerpt) => ({
            ...identity,
            excerpt,
          }));
        },
      );
    }
    if (sections.includes("claims")) {
      result.claims = projectCollection(
        this.claims.list(input).items,
        10,
        bytes,
        (item, available) => {
          const { intent, ...identity } = item;
          return projectExcerpt(
            intent ?? "",
            input.query,
            available,
            (excerpt) => ({
              ...identity,
              intent: intent === null ? null : excerpt,
            }),
          );
        },
      );
    }
    if (sections.includes("decisions")) {
      const { items } = this.decisions.list({
        projectId: input.projectId,
        status: "active",
        limit: 6,
      });
      result.decisions = projectCollection(items, 5, bytes, (item, available) =>
        projectExcerpt(item.decision, input.query, available, (excerpt) => ({
          id: item.id,
          subject: item.subject,
          createdAt: item.createdAt,
          excerpt,
        })),
      );
    }
    if (sections.includes("activity")) {
      const { items } = this.activity.recent({
        projectId: input.projectId,
        since: input.since,
        category: "knowledge",
        limit: 6,
      });
      result.activity = projectCollection(
        items,
        5,
        bytes,
        (event, available) => {
          const { metadata: _metadata, message: _message, ...identity } = event;
          const { text, reference } = this.change(event);
          return projectExcerpt(text, input.query, available, (excerpt) => ({
            ...identity,
            excerpt,
            reference,
          }));
        },
      );
    }
    return result;
  }
}
