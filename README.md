# Agent Memory

A local Bun daemon for shared agent knowledge and coordination. One process owns one SQLite database. REST, MCP over HTTP, and optional MCP stdio call the same application services.

## Run

Requires Bun 1.4.2 or later.

```sh
bun install --frozen-lockfile
bun start
```

REST listens at `http://127.0.0.1:8787`; MCP listens at `http://127.0.0.1:8787/mcp`. The database defaults to `~/.agent-memory/memory.sqlite`. Startup applies bundled migrations automatically. Logs are JSON lines on stderr.

```sh
curl http://127.0.0.1:8787/health
bun run check   # TypeScript and all integration tests
bun run demo    # Temporary daemon plus two independent agent processes
bun run build   # Standalone executable: dist/memd
```

The demo verifies shared observations, activity visibility, claim conflict and handoff, and context version 3 → 4 with a stale-write rejection. It cleans up its temporary database and processes.

## Configuration

| Variable                         | Default                         |
| -------------------------------- | ------------------------------- |
| `AGENT_MEMORY_HOST`              | `127.0.0.1`                     |
| `AGENT_MEMORY_PORT`              | `8787`                          |
| `AGENT_MEMORY_DB`                | `~/.agent-memory/memory.sqlite` |
| `AGENT_MEMORY_DEFAULT_CLAIM_TTL` | `300` seconds                   |
| `AGENT_MEMORY_MAX_CLAIM_TTL`     | `3600` seconds                  |

Only loopback hosts (`127.0.0.1`, `localhost`, `::1`) are accepted. Port `0` lets the OS select a free port, reported in the startup log. Relative database paths resolve against the daemon's working directory; `~/` is expanded.

For project-local persistence:

```sh
AGENT_MEMORY_DB=./.agent-memory/memory.sqlite bun start
```

SQLite uses strict bindings, WAL, foreign keys and a 5-second busy timeout. Exclusive connection mode enforces the single-daemon boundary even across different ports. A second daemon fails with `database is locked`; connect it to the running daemon instead. The OS releases the lock if the process crashes. Exclusive WAL mode can omit the `-shm` file.

## TypeScript client

The package root exports `MemoryClient`, `MemoryClientError`, and domain response types. Within this checkout:

```ts
import { MemoryClient, MemoryClientError } from "./src/client/memory-client";

const memory = new MemoryClient({
  baseUrl: "http://127.0.0.1:8787",
  projectId: "new-faces",
  agentId: "codex-01",
});

await memory.remember({
  type: "observation",
  content: "Talent search currently uses offset pagination.",
  metadata: { files: ["src/services/search.ts"] },
});
const { items } = await memory.search({ query: "search pagination" });
const claim = await memory.claim({
  resource: "file:src/services/search.ts",
  intent: "Implement cursor pagination",
  ttlSeconds: 300,
});
try {
  // Work here; renewClaim(claim.id) before the lease expires during longer work.
} finally {
  await memory.releaseClaim(claim.id);
}

try {
  await memory.updateContext({
    expectedVersion: 0,
    content: "# Architecture\nBun and SQLite.",
  });
} catch (error) {
  if (
    error instanceof MemoryClientError &&
    error.code === "CONTEXT_VERSION_CONFLICT"
  ) {
    const latest = await memory.getContext();
    // Reconcile your intended change with latest.content before retrying.
  } else throw error;
}
```

Other methods: `listClaims`, `renewClaim`, `getContext`, `updateContext`, `recordDecision`, `listDecisions`, `recentActivity`, and `health`. The client validates requests and responses, includes project/agent identity, and throws `MemoryClientError` for daemon errors. Requests have a 10-second timeout and are never automatically retried. Network failures do not prove that a mutation failed to commit.

## HTTP API

Bodies use `Content-Type: application/json`. Responses contain camelCase properties, decoded JSON metadata, explicit nulls for missing optional record values, and Unix milliseconds for timestamps. Unknown input fields are rejected. Create endpoints return complete records; claim acquisition wraps the claim in `{ granted: true, claim }`.

| Method and path                | Request                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `GET /health`                  | —                                                               |
| `POST /memories`               | `{ projectId, agentId, type, content, importance?, metadata? }` |
| `GET /memories/search`         | `?projectId=…&q=…&limit=10`                                     |
| `POST /claims`                 | `{ projectId, agentId, resource, intent?, ttlSeconds? }`        |
| `GET /claims`                  | `?projectId=…&resource=…`                                       |
| `POST /claims/:id/renew`       | `{ agentId, ttlSeconds? }`                                      |
| `DELETE /claims/:id`           | JSON body `{ agentId }`                                         |
| `GET /projects/:id/context`    | —                                                               |
| `PUT /projects/:id/context`    | `{ agentId, expectedVersion, content }`                         |
| `POST /projects/:id/decisions` | `{ agentId, subject, decision, reasoning?, supersedesId? }`     |
| `GET /projects/:id/decisions`  | `?status=active&limit=50`                                       |
| `GET /projects/:id/activity`   | `?limit=50&since=…&agentId=…&type=…`                            |

List/search responses use `{ items: [...] }`. Search defaults to 10 results; decisions and activity default to 50. Limits range from 1 to 200. Claims list all active claims matching the requested scope. Project and agent IDs use letters, numbers, dots, underscores and hyphens, up to 128 characters, starting with a letter or number. No project registration is required.

Errors have `{ error: { code, message, details? } }`. Claim conflicts additionally return `{ granted: false, conflict: { claimId, agentId, resource, intent, expiresAt } }` with HTTP 409. Canonical codes and DTO schemas live in `src/domain/`.

## MCP

MCP targets protocol **2026-07-28** using the official TypeScript SDK v2. Both HTTP and stdio explicitly reject legacy protocol openings. Connect clients to the existing daemon's `/mcp` endpoint for concurrent use.

For a TypeScript MCP client:

```ts
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const client = new Client(
  { name: "project-agent", version: "1.0.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8787/mcp")),
);
const result = await client.callTool({
  name: "memory_search",
  arguments: { projectId: "new-faces", query: "pagination", limit: 10 },
});
await client.close();
```

Tools:

```text
memory_remember          memory_search
claim_acquire            claim_release           claim_renew
claims_list              project_context_get     project_context_update
decision_record          decisions_list          activity_recent
```

Tool input schemas mirror the HTTP contracts: `query` replaces HTTP's `q`, route IDs become `projectId` or `claimId`, and filters are typed properties. Domain failures carry `isError: true` and the same structured error codes as HTTP. The MCP SDK handles malformed protocol messages and schema-invalid tool calls. Resources return JSON views of the same services:

```text
memory://projects/{projectId}/context
memory://projects/{projectId}/activity
memory://projects/{projectId}/decisions
memory://projects/{projectId}/claims
```

To let one MCP host launch and own the daemon, configure its executable as the absolute path to `bun`, with arguments `run`, `/absolute/path/agent-memory/src/index.ts`, `--stdio`. Configure environment variables as needed. This process also exposes REST and MCP HTTP for other agents. Its lifetime follows the launching host's stdin; closing stdin stops the daemon. All diagnostics stay on stderr.

Multiple hosts must connect to the HTTP endpoint of that daemon. Launching a separate stdio daemon for every agent against the same database is intentionally rejected.

## Domain guarantees

- **Memories:** append-only, including database enforcement. FTS5 indexes inserts in the same transaction. Plain-word search requires all words, ignores punctuation, and is always project scoped. Ranking is internal and never leaks an FTS query language into the API.
- **Claims:** unique `(projectId, resource)` plus an immediate transaction gives one winner. Expiration is `expiresAt <= now`. Acquisition, claim listing and activity reads lazily remove expired claims and record expiration once. No worker or timer is required. Only the declared owner may renew or release. Renewal extends from the current time without shortening an existing lease. Expired leases cannot be revived; after cleanup their IDs return `CLAIM_NOT_FOUND`.
- **Resources:** `kind:name`; the kind is lowercased. File/directory paths normalize separators, repeated slashes, `.` and internal `..`, and reject absolute or escaping paths. Path case and named-resource case are preserved. Claims match exact normalized strings; directory/file hierarchy and filesystem symlinks are not resolved.
- **Context:** read before changing. A missing context returns `PROJECT_NOT_FOUND`; initialize with `expectedVersion: 0` to create version 1. Existing updates increment only when the expected version matches. A conflict includes `actualVersion`; reconcile after rereading.
- **Decisions:** append new decisions and explicitly supersede an active predecessor in the same project. A predecessor can have only one successor. A stale attempt returns `DECISION_CONFLICT`. Status changes, the new decision and both events commit together.
- **Activity:** append-only. Every successful mutation writes its semantic event in the same transaction. Newest first, with insertion order breaking timestamp ties. `since` is inclusive; deduplicate by event ID when polling. This is a bounded recent feed, not a complete replay/pagination protocol. Expiration events identify the original lease owner.

Memories, context, decisions and activity persist indefinitely in v1. Agent IDs are self-reported identities, not authentication. The daemon accepts loopback access, validates Host/Origin and inputs, uses parameterized SQL, and exposes neither SQL nor filesystem access. There are no accounts, agent scheduling, background workers, embeddings, cloud services or web UI.

## Implementation

```text
HTTP / MCP → application services → repository interfaces → bun:sqlite
```

`application.ts` wires one set of services and repositories. `domain/contracts.ts` defines transport schemas and inferred types; SQLite rows and SDK responses are validated at their respective boundaries. `ClaimService.acquire()` is the single claim implementation. Transactions cover the domain mutation and its events. SQL migrations are imported as text and bundled into the standalone binary.

The tests cover domain transitions, transaction rollback, HTTP boundaries, all MCP tools/resources on the pinned protocol, stdio/HTTP shared state, independent process coordination, persistence/restart and rejection of a second database owner.

Reusable agent instructions: [docs/agent-instructions.md](docs/agent-instructions.md).

Implementation references: [Bun SQLite](https://bun.com/docs/runtime/sqlite), [SQLite exclusive WAL](https://www.sqlite.org/walformat.html), [MCP web-standard serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/web-standard.md), [MCP stdio serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md), [MCP protocol versions](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).
