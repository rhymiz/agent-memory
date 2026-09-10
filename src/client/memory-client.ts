import { z } from "zod";
import * as c from "../domain/contracts";
import { errorResponse, type ErrorCode } from "../domain/errors";

const optionsSchema = z.strictObject({
  baseUrl: z.url(),
  projectId: c.identifier,
  agentId: c.identifier,
});
export interface MemoryClientOptions {
  baseUrl: string;
  projectId: string;
  agentId: string;
}

export class MemoryClientError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: c.Metadata,
  ) {
    super(message);
    this.name = "MemoryClientError";
  }
}

export class MemoryClient {
  private readonly options: MemoryClientOptions;
  constructor(options: MemoryClientOptions) {
    this.options = optionsSchema.parse(options);
  }
  private get projectPath(): string {
    return `/projects/${encodeURIComponent(this.options.projectId)}`;
  }
  private get actor() {
    return { projectId: this.options.projectId, agentId: this.options.agentId };
  }
  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(new URL(path, this.options.baseUrl), {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new MemoryClientError(
        "INTERNAL_ERROR",
        "Daemon returned a non-JSON response.",
        response.status,
      );
    }
    if (!response.ok) {
      const parsed = errorResponse.safeParse(data);
      if (!parsed.success)
        throw new MemoryClientError(
          "INTERNAL_ERROR",
          "Daemon returned an invalid error response.",
          response.status,
        );
      const { code, message, details } = parsed.data.error;
      throw new MemoryClientError(code, message, response.status, details);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new MemoryClientError(
        "INTERNAL_ERROR",
        "Daemon response does not match the API contract.",
        response.status,
      );
    return parsed.data;
  }
  private query(values: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) params.set(key, String(value));
    return `?${params}`;
  }
  remember(input: Omit<c.RememberInput, "projectId" | "agentId">) {
    return this.request(
      "POST",
      "/memories",
      c.memorySchema,
      c.rememberInput.parse({ ...input, ...this.actor }),
    );
  }
  search(input: Omit<c.SearchInput, "projectId">) {
    const parsed = c.searchInput.parse({
      ...input,
      projectId: this.options.projectId,
    });
    return this.request(
      "GET",
      `/memories/search${this.query({ projectId: parsed.projectId, q: parsed.query, limit: parsed.limit })}`,
      c.memoriesResult,
    );
  }
  getMemory(memoryId: string) {
    const input = c.memoryGetInput.parse({
      memoryId,
      projectId: this.options.projectId,
    });
    return this.request(
      "GET",
      `/memories/${encodeURIComponent(input.memoryId)}${this.query({ projectId: input.projectId })}`,
      c.memorySchema,
    );
  }
  updateMemory(
    memoryId: string,
    input: Omit<c.MemoryUpdateInput, "memoryId" | "projectId" | "agentId">,
  ) {
    const { memoryId: id, ...body } = c.memoryUpdateInput.parse({
      ...input,
      ...this.actor,
      memoryId,
    });
    return this.request(
      "PATCH",
      `/memories/${encodeURIComponent(id)}`,
      c.memorySchema,
      body,
    );
  }
  deleteMemory(memoryId: string, expectedVersion: number) {
    const { memoryId: id, ...body } = c.memoryDeleteInput.parse({
      ...this.actor,
      memoryId,
      expectedVersion,
    });
    return this.request(
      "DELETE",
      `/memories/${encodeURIComponent(id)}`,
      c.memoryDeleted,
      body,
    );
  }
  async claim(input: Omit<c.AcquireInput, "projectId" | "agentId">) {
    const result = await this.request(
      "POST",
      "/claims",
      c.claimGranted,
      c.acquireInput.parse({ ...input, ...this.actor }),
    );
    return result.claim;
  }
  releaseClaim(claimId: string) {
    c.releaseInput.parse({ claimId, agentId: this.options.agentId });
    return this.request(
      "DELETE",
      `/claims/${encodeURIComponent(claimId)}`,
      c.claimReleased,
      { agentId: this.options.agentId },
    );
  }
  renewClaim(claimId: string, ttlSeconds?: number) {
    const input = c.renewInput.parse({
      claimId,
      agentId: this.options.agentId,
      ttlSeconds,
    });
    return this.request(
      "POST",
      `/claims/${encodeURIComponent(claimId)}/renew`,
      c.claimSchema,
      { agentId: input.agentId, ttlSeconds: input.ttlSeconds },
    );
  }
  listClaims(input: Omit<c.ClaimsInput, "projectId"> = {}) {
    const parsed = c.claimsInput.parse({
      ...input,
      projectId: this.options.projectId,
    });
    return this.request("GET", `/claims${this.query(parsed)}`, c.claimsResult);
  }
  getContext() {
    return this.request("GET", `${this.projectPath}/context`, c.contextSchema);
  }
  updateContext(input: Omit<c.ContextUpdateInput, "projectId" | "agentId">) {
    return this.request(
      "PUT",
      `${this.projectPath}/context`,
      c.contextSchema,
      c.contextUpdateBody.parse({ ...input, agentId: this.options.agentId }),
    );
  }
  recordDecision(input: Omit<c.DecisionInput, "projectId" | "agentId">) {
    return this.request(
      "POST",
      `${this.projectPath}/decisions`,
      c.decisionSchema,
      c.decisionBody.parse({ ...input, agentId: this.options.agentId }),
    );
  }
  listDecisions(input: Omit<c.DecisionsInput, "projectId"> = {}) {
    const parsed = c.decisionsInput.omit({ projectId: true }).parse(input);
    return this.request(
      "GET",
      `${this.projectPath}/decisions${this.query(parsed)}`,
      c.decisionsResult,
    );
  }
  recentActivity(input: Omit<c.ActivityInput, "projectId"> = {}) {
    const parsed = c.activityInput.omit({ projectId: true }).parse(input);
    return this.request(
      "GET",
      `${this.projectPath}/activity${this.query(parsed)}`,
      c.activityResult,
    );
  }
  health() {
    return this.request("GET", "/health", c.healthSchema);
  }
}

export type {
  Memory,
  Claim,
  ProjectContext,
  Decision,
  ActivityEvent,
  Metadata,
  MemoryDeleted,
} from "../domain/contracts";
