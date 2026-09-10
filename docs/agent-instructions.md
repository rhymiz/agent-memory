# Shared memory and coordination contract

Use the shared memory daemon at `http://127.0.0.1:8787` (REST) or `/mcp` (MCP protocol 2026-07-28). Use a consistent project ID across agents, and an agent ID unique and stable for your execution. Never open the daemon's SQLite database directly.

Before significant project work:

1. Read `project_context_get` for canonical context. If it has never been created, initialize agreed project context with `expectedVersion: 0`.
2. Read `activity_recent` to understand other agents' recent work.
3. Call `memory_search` with focused terms relevant to the task. Retrieve intentionally; do not dump every memory into your context.
4. Check `claims_list` for the resources you intend to modify.
5. Call `claim_acquire` when concurrent modification would be unsafe. Listing is advisory; acquisition is the atomic ownership check. Do not start the conflicting work unless acquisition succeeds.

During work:

- Use `memory_remember` for reusable findings, constraints, facts, preferences and results. Include useful file or feature metadata. Do not record every thought or file you opened.
- Verify retrieved knowledge when the repository may have changed; durable memories can become stale.
- Use `decision_record` for architectural and product decisions. Include reasoning. When changing a decision, set `supersedesId` to the active predecessor; preserve its history.
- Renew owned claims with `claim_renew` well before expiry, for example halfway through the TTL. After expiry or uncertain renewal, stop conflicting modifications and acquire a new lease before continuing.
- For context updates, send the version you read as `expectedVersion`. On `CONTEXT_VERSION_CONFLICT`, reread and reconcile before retrying. Never blindly overwrite with a new version number.
- If a network request fails, its mutation may still have committed. Inspect claims, context, decisions or activity before retrying a write.

After work:

1. Record important results as memory.
2. Update canonical context if the project state materially changed, using optimistic versioning.
3. Release every active claim you own, including on cancellation when possible.

Use canonical resources such as `file:src/services/search.ts`, `directory:src/components/search`, `feature:talent-search`, `schema:database`, `architecture:authentication`, or `package:billing`. File paths must be project-relative. A directory claim does not automatically conflict with a file claim: agree on a shared resource scope when coordinating related work.

On `CLAIM_CONFLICT`, inspect the owner's intent and expiration and work on an independent resource or wait. Do not impersonate another agent to release its lease. These are cooperative coordination claims, not filesystem enforcement or authentication.

Good memory: "Organization profiles must remain publicly accessible without authentication."

Good decision: "Use cursor pagination because the upstream API cannot provide stable offsets."

Trivial activity such as "I opened search.ts" does not belong in shared memory.
