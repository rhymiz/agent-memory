# Agent Memory

A local Bun daemon for shared agent knowledge and coordination. One process owns one SQLite database. REST, MCP over HTTP, and optional MCP stdio call the same application services.

## Run

Requires Bun 1.4.2 or later.

```sh
bun install --frozen-lockfile
bun run model:download # One build/setup download; inference is fully offline
bun start
```

REST listens at `http://127.0.0.1:8787`; MCP listens at `http://127.0.0.1:8787/mcp`. The database defaults to `~/.agent-memory/memory.sqlite`. Startup applies bundled migrations and indexes existing memories before accepting requests. Logs are JSON lines on stderr.

```sh
curl http://127.0.0.1:8787/health
bun run check   # TypeScript and all integration tests
bun run demo    # Temporary daemon plus two independent agent processes
bun run build   # Standalone executable with model: dist/memd
bun run verify:binary # macOS: fresh cache, external network and source access denied
```

The demo verifies shared observations, activity visibility, claim conflict and handoff, and context version 3 → 4 with a stale-write rejection. It cleans up its temporary database and processes.

## Local semantic search

`memory_search` and `MemoryClient.search()` combine exact terms with semantic
similarity. Existing calls automatically use hybrid retrieval; no new tool,
API key, inference server, or vector database is needed. For example, a query
like “Can visitors view company pages without signing in?” can find a memory
saying “Public organization profiles must remain accessible without authentication.”
Include exact file names or identifiers when they matter, and use a small `limit`.

The pinned [EmbeddingGemma 300M ONNX model](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX)
runs locally on CPU using ONNX Runtime and Hugging Face's tokenizer. The q8
weights use 768-dimensional normalized embeddings. Paragraphs are split into
overlapping windows of at most 384 tokens with 48-token overlap; small paragraphs
are grouped, and identical chunks are indexed once. All content is covered,
including content beyond the model's 2,048-token context window. Only memory
content is embedded; metadata stays structured.

SQLite stores versioned chunk vectors with each memory. Search scans the current
project's vectors, takes the best chunk per memory, and combines semantic and
FTS5 ranks using reciprocal rank fusion. A cosine floor of 0.3 filters weak
semantic candidates; this is a retrieval heuristic, not a confidence probability.
FTS5 still finds exact terms regardless of that floor. Results are unique memory
records, defaulting to 10 and capped at 200. No automatic memory dump is added to
agent context. This exact scan suits a small local corpus; cost grows with the
project's indexed chunks.

Creating or correcting a memory completes indexing before returning success.
Deletes remove vectors in the same transaction. Inference or transaction failure
leaves the previous memory and indexes intact. Startup backfills missing or
outdated embeddings in resumable batches without changing memory versions or
creating duplicate activity. Changing the pinned model or chunking contract
requires a new model identity and automatically rebuilds the index.

### Standalone executable

`bun run build` fetches missing build assets at a pinned revision, verifies their
SHA-256 checksums, and embeds the weights, tokenizer, native CPU runtime, and
[distribution notices](licenses/README.md) into `dist/memd`. The resulting macOS
ARM64 executable is approximately 445 MB. It needs neither Bun nor `node_modules`
on the destination machine. Build on the target OS and architecture; macOS ARM64
is verified here. Cross-compiling native inference assets is not supported by
this build script.

Native ONNX loading requires physical files. On first launch the executable
extracts its embedded assets into a versioned runtime directory (roughly another
380 MB), verifies them on later launches, and repairs damaged assets from the
binary. It performs **no runtime downloads**. The daemon still runs as one Bun
process; no background inference process or worker is introduced. Only build/setup
requires network access. Missing source-development assets cause startup to fail
with instructions to run `bun run model:download`.

The macOS packaging check launches a copied executable outside this checkout with
a fresh cache, denies reads from the source repository and all external network
connections, and exercises HTTP/MCP retrieval, restart, cache repair, correction,
and deletion. `bun run check` also covers real model inference and long memories.

## Configuration

| Variable                         | Default                         |
| -------------------------------- | ------------------------------- |
| `AGENT_MEMORY_HOST`              | `127.0.0.1`                     |
| `AGENT_MEMORY_PORT`              | `8787`                          |
| `AGENT_MEMORY_RUNTIME_DIR`       | `~/.agent-memory/runtime`       |
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

Other methods: `listClaims`, `renewClaim`, `getContext`, `updateContext`, `recordDecision`, `listDecisions`, `recentActivity`, and `health`. The client validates requests and responses, includes project/agent identity, and throws `MemoryClientError` for daemon errors. Requests have a 120-second timeout (configurable with `timeoutMs`) and are never automatically retried. Network failures do not prove that a mutation failed to commit.

Correct an existing memory instead of appending a contradictory copy:

```ts
const entry = await memory.getMemory("mem_...");
const corrected = await memory.updateMemory(entry.id, {
  expectedVersion: entry.version,
  content: "Talent search now uses cursor pagination.",
});

// If this entry later becomes obsolete or redundant, remove it:
await memory.deleteMemory(corrected.id, corrected.version);
```

Search results also include `version`, so an agent can update or delete a result directly. On `MEMORY_VERSION_CONFLICT`, reread with `getMemory` and reconsider the change using the current content. Any trusted agent working in the same project may maintain its memories; `agentId` remains the original author and `updatedBy` identifies the latest editor.

## HTTP API

Bodies use `Content-Type: application/json`. Responses contain camelCase properties, decoded JSON metadata, explicit nulls for missing optional record values, and Unix milliseconds for timestamps. Unknown input fields are rejected. Create endpoints return complete records; claim acquisition wraps the claim in `{ granted: true, claim }`.

| Method and path                | Request                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `GET /health`                  | —                                                                                  |
| `POST /memories`               | `{ projectId, agentId, type, content, importance?, metadata? }`                    |
| `GET /memories/search`         | `?projectId=…&q=…&limit=10`                                                        |
| `GET /memories/:id`            | `?projectId=…`                                                                     |
| `PATCH /memories/:id`          | `{ projectId, agentId, expectedVersion, content?, type?, importance?, metadata? }` |
| `DELETE /memories/:id`         | JSON body `{ projectId, agentId, expectedVersion }`                                |
| `POST /claims`                 | `{ projectId, agentId, resource, intent?, ttlSeconds? }`                           |
| `GET /claims`                  | `?projectId=…&resource=…`                                                          |
| `POST /claims/:id/renew`       | `{ agentId, ttlSeconds? }`                                                         |
| `DELETE /claims/:id`           | JSON body `{ agentId }`                                                            |
| `GET /projects/:id/context`    | —                                                                                  |
| `PUT /projects/:id/context`    | `{ agentId, expectedVersion, content }`                                            |
| `POST /projects/:id/decisions` | `{ agentId, subject, decision, reasoning?, supersedesId? }`                        |
| `GET /projects/:id/decisions`  | `?status=active&limit=50`                                                          |
| `GET /projects/:id/activity`   | `?limit=50&since=…&agentId=…&type=…`                                               |

List/search responses use `{ items: [...] }`. Search defaults to 10 results; decisions and activity default to 50. Limits range from 1 to 200. Claims list all active claims matching the requested scope. Project and agent IDs use letters, numbers, dots, underscores and hyphens, up to 128 characters, starting with a letter or number. No project registration is required.

Errors have `{ error: { code, message, details? } }`. Claim conflicts additionally return `{ granted: false, conflict: { claimId, agentId, resource, intent, expiresAt } }` with HTTP 409. Canonical codes and DTO schemas live in `src/domain/`.

Memory patches require at least one editable field. Omitted fields remain unchanged; `null` clears `importance` or `metadata`. Metadata is replaced as a whole. Both patch and delete require a positive `expectedVersion`: a stale version returns HTTP 409 `MEMORY_VERSION_CONFLICT`, while an absent memory or wrong project returns HTTP 404 `MEMORY_NOT_FOUND`. Delete returns `{ deleted: true, memoryId }`.

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
memory_get               memory_update           memory_delete
claim_acquire            claim_release           claim_renew
claims_list              project_context_get     project_context_update
decision_record          decisions_list          activity_recent
```

Tool input schemas mirror the HTTP contracts: `query` replaces HTTP's `q`, route IDs become `projectId`, `memoryId` or `claimId`, and filters are typed properties. Domain failures carry `isError: true` and the same structured error codes as HTTP. The MCP SDK handles malformed protocol messages and schema-invalid tool calls. Resources return JSON views of the same services:

```text
memory://projects/{projectId}/context
memory://projects/{projectId}/activity
memory://projects/{projectId}/decisions
memory://projects/{projectId}/claims
```

To let one MCP host launch and own the daemon, configure its executable as the absolute path to `bun`, with arguments `run`, `/absolute/path/agent-memory/src/index.ts`, `--stdio`. Configure environment variables as needed. This process also exposes REST and MCP HTTP for other agents. Its lifetime follows the launching host's stdin; closing stdin stops the daemon. All diagnostics stay on stderr.

Multiple hosts must connect to the HTTP endpoint of that daemon. Launching a separate stdio daemon for every agent against the same database is intentionally rejected.

## Domain guarantees

- **Memories:** versioned, editable and deletable within a project. Creation starts at version 1; updates preserve the ID, original author and creation time, increment the version, and record the editor and update time. Updates and deletes use an immediate transaction and a version-conditional write. FTS5 triggers and versioned embeddings keep both search indexes synchronized in that transaction. Embeddings are computed before taking the write transaction; a correction rechecks its version afterward. Search only sees current versions and is always project scoped. Ranking is internal and never exposes an FTS query language or vectors through the API.
- **Claims:** unique `(projectId, resource)` plus an immediate transaction gives one winner. Expiration is `expiresAt <= now`. Acquisition, claim listing and activity reads lazily remove expired claims and record expiration once. No worker or timer is required. Only the declared owner may renew or release. Renewal extends from the current time without shortening an existing lease. Expired leases cannot be revived; after cleanup their IDs return `CLAIM_NOT_FOUND`.
- **Resources:** `kind:name`; the kind is lowercased. File/directory paths normalize separators, repeated slashes, `.` and internal `..`, and reject absolute or escaping paths. Path case and named-resource case are preserved. Claims match exact normalized strings; directory/file hierarchy and filesystem symlinks are not resolved.
- **Context:** read before changing. A missing context returns `PROJECT_NOT_FOUND`; initialize with `expectedVersion: 0` to create version 1. Existing updates increment only when the expected version matches. A conflict includes `actualVersion`; reconcile after rereading.
- **Decisions:** append new decisions and explicitly supersede an active predecessor in the same project. A predecessor can have only one successor. A stale attempt returns `DECISION_CONFLICT`. Status changes, the new decision and both events commit together.
- **Activity:** append-only. Every successful mutation writes its semantic event in the same transaction. Newest first, with insertion order breaking timestamp ties. `since` is inclusive; deduplicate by event ID when polling. This is a bounded recent feed, not a complete replay/pagination protocol. Expiration events identify the original lease owner.

Memories persist until explicitly deleted; context, decisions and activity persist indefinitely. Memory updates replace content in place and deletion removes the record and its search entry; there is no memory revision archive or undo API. `memory.updated` and `memory.deleted` activity records retain IDs, versions and actors, without copying the removed content. Existing memories are preserved during migration and begin at version 1. Agent IDs are self-reported identities, not authentication. The daemon accepts loopback access, validates Host/Origin and inputs, uses parameterized SQL, and exposes neither SQL nor filesystem access. There are no accounts, agent scheduling, background workers, cloud services or web UI.

## Implementation

```text
HTTP / MCP → application services → repository interfaces → bun:sqlite
```

`application.ts` wires one set of services and repositories. `domain/contracts.ts` defines transport schemas and inferred types; SQLite rows and SDK responses are validated at their respective boundaries. `ClaimService.acquire()` is the single claim implementation. Transactions cover the domain mutation and its events. SQL migrations are imported as text and bundled into the standalone binary.

The tests cover domain transitions, transaction rollback, HTTP boundaries, all MCP tools/resources on the pinned protocol, stdio/HTTP shared state, independent process coordination, persistence/restart and rejection of a second database owner.

Reusable agent instructions: [docs/agent-instructions.md](docs/agent-instructions.md).

Implementation references: [Bun SQLite](https://bun.com/docs/runtime/sqlite), [SQLite FTS5 synchronization](https://www.sqlite.org/fts5.html#external_content_tables), [SQLite exclusive WAL](https://www.sqlite.org/walformat.html), [MCP web-standard serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/web-standard.md), [MCP stdio serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md), [MCP protocol versions](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).
