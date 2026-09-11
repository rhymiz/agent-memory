import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { Application } from "../application";
import * as c from "../domain/contracts";
import { publicError } from "../domain/errors";

async function result(
  operation: () => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const data = await operation();
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (error) {
    const failure = publicError(error);
    const data =
      failure.code === "CLAIM_CONFLICT"
        ? { ...failure.toJSON(), granted: false, conflict: failure.details }
        : failure.toJSON();
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
}
const read = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};
const destructive = { ...write, destructiveHint: true };

export function registerTools(server: McpServer, app: Application): void {
  server.registerTool(
    "memory_remember",
    {
      description:
        "Store new reusable project knowledge. Correct existing knowledge with memory_update; remove obsolete or duplicate knowledge with memory_delete.",
      inputSchema: c.rememberInput,
      outputSchema: c.memorySchema,
      annotations: write,
    },
    (input) => result(() => app.memories.remember(input)),
  );
  server.registerTool(
    "memory_search",
    {
      description:
        "Search project knowledge by meaning and exact terms using local hybrid retrieval. Use a natural-language question or task description; include identifiers when relevant. Results are project scoped and limited.",
      inputSchema: c.searchInput,
      outputSchema: c.memoriesResult,
      annotations: read,
    },
    (input) => result(() => app.memories.search(input)),
  );
  server.registerTool(
    "memory_get",
    {
      description:
        "Read one project memory by ID, including its current version for update or deletion.",
      inputSchema: c.memoryGetInput,
      outputSchema: c.memorySchema,
      annotations: read,
    },
    (input) => result(() => app.memories.get(input)),
  );
  server.registerTool(
    "memory_update",
    {
      description:
        "Correct a specific memory using its observed expectedVersion. Omitted fields stay unchanged; null clears importance or metadata. Old content is replaced in search. Reread after MEMORY_VERSION_CONFLICT.",
      inputSchema: c.memoryUpdateInput,
      outputSchema: c.memorySchema,
      annotations: destructive,
    },
    (input) => result(() => app.memories.update(input)),
  );
  server.registerTool(
    "memory_delete",
    {
      description:
        "Permanently remove a specific obsolete or duplicate memory from storage and search using its observed expectedVersion. Reread after MEMORY_VERSION_CONFLICT. An activity event retains its ID, not its content.",
      inputSchema: c.memoryDeleteInput,
      outputSchema: c.memoryDeleted,
      annotations: destructive,
    },
    (input) => result(() => app.memories.delete(input)),
  );
  server.registerTool(
    "claim_acquire",
    {
      description:
        "Acquire an exclusive resource lease for work you are actively doing. Omit ttlSeconds for the daemon default (normally 30 minutes). CLAIM_CONFLICT means an active lease exists, including one you own. Use claims_renew to renew multiple claims in one call.",
      inputSchema: c.acquireInput,
      outputSchema: c.claimGranted,
      annotations: write,
    },
    (input) => result(() => app.claims.acquire(input)),
  );
  server.registerTool(
    "claim_release",
    {
      description: "Release your active claim after work completes.",
      inputSchema: c.releaseInput,
      outputSchema: c.claimReleased,
      annotations: write,
    },
    (input) => result(() => app.claims.release(input)),
  );
  server.registerTool(
    "claim_renew",
    {
      description:
        "Renew one active claim only when half its requested TTL remains; early calls do nothing. For multiple claims use one claims_renew call instead of a per-file loop. Omit ttlSeconds for the daemon default. Expired claims cannot be revived.",
      inputSchema: c.renewInput,
      outputSchema: c.claimSchema,
      annotations: write,
    },
    (input) => result(() => app.claims.renew(input)),
  );
  server.registerTool(
    "claims_renew",
    {
      description:
        "Renew 1–500 owned project claims atomically in one call. Omit ttlSeconds for the daemon default (normally 30 minutes). Early calls do nothing. Save the returned renewAfter and do not call again before that wall-clock time. Any missing, expired, foreign-project or non-owned claim rejects the entire batch; reread claims and stop edits on lost resources before retrying. Returns a compact summary, not one record per file.",
      inputSchema: c.renewClaimsInput,
      outputSchema: c.claimsRenewed,
      annotations: write,
    },
    (input) => result(() => app.claims.renewMany(input)),
  );
  server.registerTool(
    "claims_list",
    {
      description:
        "List active project claims, optionally matching one normalized resource. Claims do not conflict hierarchically.",
      inputSchema: c.claimsInput,
      outputSchema: c.claimsResult,
      annotations: read,
    },
    (input) => result(() => app.claims.list(input)),
  );
  server.registerTool(
    "project_context_get",
    {
      description: "Read canonical project context and its version.",
      inputSchema: c.projectInput,
      outputSchema: c.contextSchema,
      annotations: read,
    },
    (input) => result(() => app.context.get(input)),
  );
  server.registerTool(
    "project_context_update",
    {
      description:
        "Update context using its observed version. Use expectedVersion 0 to create; reread after CONTEXT_VERSION_CONFLICT.",
      inputSchema: c.contextUpdateInput,
      outputSchema: c.contextSchema,
      annotations: write,
    },
    (input) => result(() => app.context.update(input)),
  );
  server.registerTool(
    "decision_record",
    {
      description:
        "Record a decision, optionally superseding an active decision in the same project with explicit provenance.",
      inputSchema: c.decisionInput,
      outputSchema: c.decisionSchema,
      annotations: write,
    },
    (input) => result(() => app.decisions.record(input)),
  );
  server.registerTool(
    "decisions_list",
    {
      description:
        "Read recent project decisions, optionally filtering by active or superseded status.",
      inputSchema: c.decisionsInput,
      outputSchema: c.decisionsResult,
      annotations: read,
    },
    (input) => result(() => app.decisions.list(input)),
  );
  server.registerTool(
    "activity_recent",
    {
      description:
        "Read recent project activity, newest first. since is inclusive Unix milliseconds; deduplicate polled events by id.",
      inputSchema: c.activityInput,
      outputSchema: c.activityResult,
      annotations: read,
    },
    (input) => result(() => app.activity.recent(input)),
  );
}
