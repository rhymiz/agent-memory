# Agent Memory

A local Bun daemon for shared agent knowledge and coordination. One process owns one SQLite database. REST, MCP over HTTP, and optional MCP stdio call the same application services.

## Install on Linux

Releases include standalone Linux x64 and ARM64 executables with Bun and the
offline model bundled. No Bun, Node, or GPU installation is needed. Use a glibc
distribution (Ubuntu 22.04 or later is the release verification target); Alpine
and other musl distributions are not supported.

Once a release has been published:

```sh
curl -fsSL https://github.com/rhymiz/agent-memory/releases/latest/download/install.sh -o install-agent-memory.sh
sh install-agent-memory.sh
~/.local/bin/memd
```

The installer requires `curl` and `sha256sum`, detects the CPU architecture,
verifies the release checksum, and atomically installs `memd` into `~/.local/bin`.
Add that directory to `PATH` to run `memd` by name. It installs the executable;
run it yourself or configure your service manager to keep it running.

To select a release or installation directory:

```sh
sh install-agent-memory.sh --version 0.6.0 --bin-dir "$HOME/.local/bin"
```

Rerun the installer to upgrade, then restart your daemon. The installer does not
change the database or stop a running process. Remove the installed executable to
uninstall; persistent data remains in `~/.agent-memory`.

## Run from source

Requires Bun 1.4.2 or later.

```sh
bun install --frozen-lockfile
bun run model:download # One build/setup download; inference is fully offline
bun start
```

REST listens at `http://127.0.0.1:8787`; MCP listens at `http://127.0.0.1:8787/mcp`. The database defaults to `~/.agent-memory/memory.sqlite`. Startup applies bundled migrations and indexes existing memories before accepting requests. Application logs are JSON lines on stderr; native runtime diagnostics may be plain text.

```sh
curl http://127.0.0.1:8787/health
bun run check   # TypeScript and all integration tests
bun run demo    # Temporary daemon plus two independent agent processes
bun run build   # Standalone executable with model: dist/memd
bun run verify:binary # macOS/Linux: fresh cache, external network and source access denied
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

Search and memory listing accept the same optional filters: `types` (one or more
memory types), `updatedSince` (inclusive Unix milliseconds), and `minImportance`
(0–1). Both lexical and semantic candidates are filtered before ranking or limits.
Omitting filters searches every type. An importance threshold excludes unscored
records. Ranking remains reciprocal rank fusion with creation time breaking ties;
importance and age do not silently boost scores. Types are not quality judgments:
useful answers may be stored as results, and old constraints may still apply.

Accepted decision records have a separate lexical index over subject, decision,
and reasoning. `decisions_list({projectId, query})` / `listDecisions({query})`
rank records matching any query word with FTS5 BM25, defaulting to active decisions.
Use concise keywords; query text is escaped rather than interpreted as FTS syntax.
Omit query to retain the recent-decision listing, including both statuses unless
filtered. Decision records are not embedded or returned by memory search.

## Compact agent context

`memory_search_compact` / `MemoryClient.searchCompact()` use the same hybrid
ranking as full search, returning `{ items, hasMore }` with IDs, types, versions,
update timestamps, and `{ text, truncated }` excerpts. Excerpts are verbatim
windows around query terms; semantic-only matches use leading text. Expand a hit
with `memory_get` / `getMemory()` before correcting or deleting it. Full search
continues to return complete records with its existing contract.

Compact search defaults to 8 hits (maximum 50) and a 12000-byte budget. `maxBytes`
accepts 1024–64000 and bounds the serialized UTF-8 JSON data object, including
escaping and record fields, but excluding the MCP envelope and its duplicate
text/structured representation. Metadata is omitted. `hasMore` means additional
hits were omitted by count or byte budget; `excerpt.truncated` means that record's
text is incomplete. Tight budgets can return an empty collection with `hasMore`
set to true. Both MCP representations contain the same data.

`project_briefing` / `MemoryClient.getBriefing()` compose existing services into
bounded context, relevant memories, active claims, matching decisions, and recent
knowledge changes:

```ts
const briefing = await memory.getBriefing({
  query: "Change the pagination contract",
  maxBytes: 20000,
  memoryFilter: { types: ["fact", "constraint", "observation"] },
  sections: ["context", "memories", "claims", "activity", "decisions"],
});
```

Omit `sections` to request all five sections. Each requested section is a
bounded collection with its own omission flag; unrequested sections are absent.
Context contains at most one record: an empty collection with `hasMore: false`
means context has not been initialized. This is not an error; the skill describes
when enough verified project information exists to initialize a short index.
Decisions are active lexical matches for the briefing query, selected before the
section limit. `memoryFilter` affects the memories section only; activity still
shows recent knowledge changes of all memory types.
Activity excludes lease events before applying its limit, so lease churn cannot
hide knowledge changes. Its memory/context excerpts reflect current referenced
versions rather than historical event content; deleted memories are not recovered.

The default briefing budget is 20000 bytes, divided among requested sections.
Sections contain at most five items, except claims (ten) and context (one).
Use `since` for an inclusive activity timestamp. Expand relevant omissions with
the existing full-read tools or a narrower briefing. A brief is an orientation
view, not an atomic snapshot or a substitute for claim acquisition/version checks.
Briefings do not acquire claims or generate summaries.
Deletes remove vectors in the same transaction. Inference or transaction failure
leaves the previous memory and indexes intact. Startup backfills missing or
outdated embeddings in resumable batches without changing memory versions or
creating duplicate activity. Changing the pinned model or chunking contract
requires a new model identity and automatically rebuilds the index.

## Knowledge maintenance and inspection

Store reusable claims with their applicability and evidence pointers. A result
should state a useful outcome or unresolved handoff in one sentence plus pointers;
routine test, commit, and clean-tree receipts need no memory. Correct resolved
handoffs in place, preserving useful rationale. Use `files`, `commit`, and `pr`
for ordinary metadata and keep retrieval-critical identifiers in content. The
[knowledge workflow](skills/shared-agent-memory/references/knowledge.md) covers
types, context initialization, evidence, correction, and cautious consolidation.

`projects_list` / `listProjects()` discover projects represented in any domain,
including projects with only context, decisions, claims, or activity. `memory_list`
/ `listMemories()` return full project memories without a search query. Both use
ascending keyset pages: defaults are 50 records, maximum 200; pass `nextCursor` as
`after` until it is null. Memory lists accept the search filters. Cursors are the
last returned project ID or memory ID and remain usable after that record is
deleted. Pages reflect current state, not a frozen export across calls; concurrent
inserts before a cursor can be missed. Use these operator reads deliberately,
with small pages, rather than injecting a corpus dump into every task.

`corpus_stats` / `corpusStats()` return aggregate counts in one database transaction.
Supply `projectId` to restrict the scope. Counts cover memory types and UTF-8
content bytes, decision status, contexts, active/expired leases, knowledge and
coordination events, and embedding coverage for the running model. `asOf` is the
lease cutoff time; `embeddings.models` lists all models attached to current memory
versions. These reads do not expire claims or create activity. Event counts count
batch operations once, not once per resource. The daemon owns storage; do not copy
live SQLite/WAL files for inspection.

Measure retrieval against judged questions, not type ratios:

```sh
bun run retrieval:evaluate /path/to/cases.json [http://127.0.0.1:8787]
```

The JSON file is an array of cases containing `name`, `projectId`, `query`, and
`relevantMemoryIds` and/or `relevantDecisionIds`. Optional fields are `limit`
(default 5, maximum 50), `memoryFilter`, `decisionQuery`, and `staleMemoryIds`.
For example, with IDs from records you have read and judged:

```json
[
  {
    "name": "cursor contract",
    "projectId": "example",
    "query": "pagination cursor",
    "relevantMemoryIds": ["mem_verified"],
    "staleMemoryIds": ["mem_obsolete"]
  }
]
```

The read-only evaluator reports returned IDs, precision at K (relevant hits divided
by requested K), recall, reciprocal rank, missing expected records, and known stale
hits. Curate complete relevance judgments for each case; unlisted relevant records
would underestimate precision. An absent judgment group scores null, not zero.
Compare the same questions and judgments before/after a change. These measurements
cover the selected questions; they do not prove corpus-wide or coding improvement.

## Standalone executable

`bun run build` fetches missing build assets at a pinned revision, verifies their
SHA-256 checksums, and embeds the weights, tokenizer, native CPU runtime, and
[distribution notices](licenses/README.md) into `dist/memd`. The resulting macOS
ARM64 executable is approximately 445 MB; Linux sizes vary by architecture. It
needs neither Bun nor `node_modules` on the destination machine. Build on the
target OS and architecture so the native inference libraries match the binary.
Cross-compiling native inference assets is not supported by this build script.
Linux builds bundle only the CPU runtime; use `ONNXRUNTIME_NODE_INSTALL=skip`
during dependency installation to skip ONNX's optional CUDA download.

Native ONNX loading requires physical files. On first launch the executable
extracts its embedded assets into a versioned runtime directory (roughly another
380 MB), verifies them on later launches, and repairs damaged assets from the
binary. It performs **no runtime downloads**. The daemon still runs as one Bun
process; no background inference process or worker is introduced. Only build/setup
requires network access. Missing source-development assets cause startup to fail
with instructions to run `bun run model:download`.

The packaging check launches a copied executable outside this checkout with a
fresh cache, denies reads from the source repository and all external network
connections, and exercises HTTP/MCP retrieval, restart, cache repair, correction,
and deletion. macOS uses `sandbox-exec`; Linux requires `bubblewrap`, `curl`, and
permission to create user/network namespaces. `bun run check` also covers real
model inference and long memories.

### Publishing Linux releases

The [Linux release workflow](.github/workflows/release.yml) runs native Ubuntu
22.04 x64 and ARM64 builds for pull requests, pushes to `main`, version tags, and
manual dispatches. Each architecture must pass the application checks, standalone
offline verification, and installation of its compiled binary. Successful builds
are available as workflow artifacts.

To publish, commit the intended changes with the release version in `package.json`,
then push a matching tag such as `v0.6.0`. A mismatched tag fails verification. Once
both architectures pass, the workflow creates a GitHub release containing
`memd-linux-x64`, `memd-linux-arm64`, `SHA256SUMS`, and `install.sh`. Branch and
manual runs verify builds without publishing a release.

## Configuration

| Variable                         | Default                         |
| -------------------------------- | ------------------------------- |
| `AGENT_MEMORY_HOST`              | `127.0.0.1`                     |
| `AGENT_MEMORY_PORT`              | `8787`                          |
| `AGENT_MEMORY_RUNTIME_DIR`       | `~/.agent-memory/runtime`       |
| `AGENT_MEMORY_DB`                | `~/.agent-memory/memory.sqlite` |
| `AGENT_MEMORY_DEFAULT_CLAIM_TTL` | `1800` seconds                  |
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
});
try {
  // Work here. Renew only when due, using renewClaims([...ids]) for multiple files.
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

Other methods: `listClaims`, `renewClaim`, `renewClaims`, `getContext`, `updateContext`, `recordDecision`, `listDecisions`, `recentActivity`, and `health`. The client validates requests and responses, includes project/agent identity, and throws `MemoryClientError` for daemon errors. Requests have a 120-second timeout (configurable with `timeoutMs`) and are never automatically retried. Network failures do not prove that a mutation failed to commit.

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

Bodies use `Content-Type: application/json`. Responses contain camelCase properties, decoded JSON metadata, explicit nulls for missing optional record values, and Unix milliseconds for timestamps. Unknown input fields are rejected. Create endpoints return complete records; claim acquisition wraps the claim in `{ granted: true, claim, schedule: { expiresAt, renewAfter }, advisories }`. Update strict clients alongside the daemon to accept the acquisition envelope. The current TypeScript client accepts older responses without advisories as an empty list.

| Method and path                | Request                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `GET /health`                  | —                                                                                      |
| `GET /projects`                | `?limit=50&after=…`                                                                    |
| `GET /stats`                   | `?projectId=…` (omit for the corpus)                                                   |
| `GET /memories`                | `?projectId=…&limit=50&after=…&types=fact,constraint&updatedSince=…&minImportance=0.7` |
| `POST /memories`               | `{ projectId, agentId, type, content, importance?, metadata? }`                        |
| `GET /memories/search`         | `?projectId=…&q=…&limit=10`                                                            |
| `GET /memories/search/compact` | `?projectId=…&q=…&limit=8&maxBytes=12000`                                              |
| `GET /memories/:id`            | `?projectId=…`                                                                         |
| `PATCH /memories/:id`          | `{ projectId, agentId, expectedVersion, content?, type?, importance?, metadata? }`     |
| `DELETE /memories/:id`         | JSON body `{ projectId, agentId, expectedVersion }`                                    |
| `POST /claims`                 | `{ projectId, agentId, resource, intent?, ttlSeconds? }`                               |
| `POST /claims/acquire`         | `{ projectId, agentId, resources, intent?, ttlSeconds? }`                              |
| `POST /claims/release`         | `{ projectId, agentId, claimIds }`                                                     |
| `GET /claims`                  | `?projectId=…&resource=…`                                                              |
| `POST /claims/renew`           | `{ projectId, agentId, claimIds, ttlSeconds? }`                                        |
| `POST /claims/:id/renew`       | `{ agentId, ttlSeconds? }`                                                             |
| `DELETE /claims/:id`           | JSON body `{ agentId }`                                                                |
| `GET /projects/:id/context`    | —                                                                                      |
| `POST /projects/:id/briefing`  | `{ query, maxBytes?, sections?, since?, memoryFilter? }` (read-only)                   |
| `PUT /projects/:id/context`    | `{ agentId, expectedVersion, content }`                                                |
| `POST /projects/:id/decisions` | `{ agentId, subject, decision, reasoning?, supersedesId? }`                            |
| `GET /projects/:id/decisions`  | `?status=active&limit=50&q=…`                                                          |
| `GET /projects/:id/activity`   | `?limit=50&since=…&agentId=…&type=…&category=knowledge`                                |

Memory and project inspection pages return `{ items, nextCursor }`. Other full
list/search responses use `{ items }`; compact collections add `hasMore`. Both
memory search routes accept `types` as comma-separated values, `updatedSince`, and
`minImportance`; MCP and JSON briefing filters use an array for `types`. Full search
defaults to 10 results; decisions and activity default to 50. Their limits range
from 1 to 200. Claims list all active claims matching the requested scope.
Activity's optional category is `knowledge` or `coordination` and combines with the
existing filters. Project and agent IDs use letters, numbers, dots, underscores and
hyphens, up to 128 characters, starting with a letter or number. No project
registration is required.

Errors have `{ error: { code, message, details? } }`. Claim conflicts additionally return `{ granted: false, conflict: { claimId, agentId, resource, intent, expiresAt } }` with HTTP 409. Canonical codes and DTO schemas live in `src/domain/`.

Memory patches require at least one editable field. Omitted fields remain unchanged; `null` clears `importance` or `metadata`. Metadata is replaced as a whole. Both patch and delete require a positive `expectedVersion`: a stale version returns HTTP 409 `MEMORY_VERSION_CONFLICT`, while an absent memory or wrong project returns HTTP 404 `MEMORY_NOT_FOUND`. Delete returns `{ deleted: true, memoryId }`.

## Claim batches and renewal

Use `claims_acquire({projectId, agentId, resources, intent?, ttlSeconds?})` /
`MemoryClient.acquireClaims()` to acquire 1–500 resources atomically. The response
is `{granted: true, claims, schedule, advisories}` with every claim ID and one shared schedule.
Resources are normalized and sorted; duplicates after normalization are rejected.
A conflict rejects the entire batch, including any cleanup events from that
transaction. Individual acquisition uses the same implementation.

`claims_release({projectId, agentId, claimIds})` / `releaseClaims()` releases
1–500 claims atomically. Missing, expired, foreign-project or non-owned IDs reject
the whole batch. Reread ownership and release the remaining owned set after a
failure. Successful multi-resource acquisition/release each emit one event with
all claim IDs, resources and expiry times. These batches reduce call/event volume
without changing exact-resource conflict semantics.

Claim the actual current write set, including generated files and lockfiles when
they will be modified. Reading files does not require file ownership. Named
`phase:`/`feature:` claims are agreed work-stream mutexes and do not protect child
files. Large claim sets merit checking against actual writes; there is no arbitrary
resource cap beyond each batch's request limit and no automatic lease-event purge.

Single and batch acquisition return non-blocking, typed `advisories`:

- `large-claim-set` includes a message, `activeClaimCount`, and `threshold: 100`
  when this agent owns more than 100 active resources in this project after
  acquisition. Expired leases and other owners/projects do not count. This is a
  review threshold, not evidence that the resources are unnecessary.
- `generated-resources` includes a message and the newly acquired `resources`
  whose normalized file/directory paths contain a directory named `generated`.
  This literal path heuristic does not inspect the filesystem or recognize every
  generated output. Shared generated files still need ownership when modified.

Check advisories against the current phase's intended writes and release unused
claims. A successful acquisition remains granted; advisories create no additional
activity events and do not require permission to continue.

The daemon default is **30 minutes**, with a maximum of 60 minutes. Omit
`ttlSeconds` to use the configured default; pass it only for a deliberate override.
Claim only the files needed for the current phase of work, and release them promptly
when finished. Claims still expire when an agent crashes; the daemon does not
renew leases in the background.

Use `MemoryClient.acquireClaim()` to retain the initial schedule and advisories
alongside the claim; `claim()` remains a convenience method returning only the claim. At the
earliest owned `schedule.renewAfter`, renew the whole set in one call:

```ts
const acquired = await memory.acquireClaim({ resource: "file:src/search.ts" });
// Retain acquired.claim.id and acquired.schedule, then renew when due.
const renewal = await memory.renewClaims(ownedClaims.map((claim) => claim.id));
// Schedule the next renewal using renewal.renewAfter (UTC Unix milliseconds).
```

MCP exposes the same operation as `claims_renew({ projectId, agentId, claimIds })`.
It accepts 1–500 unique IDs and returns a compact summary:

```json
{
  "claimCount": 122,
  "renewedCount": 122,
  "expiresAt": 1789092000000,
  "renewAfter": 1789091100000
}
```

`expiresAt` is the earliest expiry in the requested set, so every requested claim
is valid until at least that time. Renew when the actual wall clock reaches
`renewAfter`, not after each tool call. Early retries return `renewedCount: 0`
and the same deadline without writing activity. When any requested claim is due,
the batch extends the set without shortening longer leases. A successful batch
emits one `claim.renewed` activity event with counts; individual renewal remains
available for a single resource and follows the same timing policy.

Renewal is all-or-nothing: any missing, expired, foreign-project or non-owned ID
rejects the entire batch with the existing claim error code and failing `claimId`.
Stop modifying any resource whose ownership was lost, reread claims, then reacquire
or remove that ID from the current work set before retrying. A batch never revives
expired claims or silently skips missing ones. Existing short leases can be
extended using the new default while they are still active.

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
memory_search_compact    project_briefing
memory_get               memory_update           memory_delete
memory_list              projects_list           corpus_stats
claim_acquire            claim_release           claim_renew
claims_acquire           claims_release
claims_list              claims_renew            project_context_get     project_context_update
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
- **Claims:** unique `(projectId, resource)` plus an immediate transaction gives one winner. Expiration is `expiresAt <= now`. Acquisition, claim listing and activity reads lazily remove expired claims and record expiration once. No worker or timer is required. Only the declared owner may renew or release. Renewal extends from the current time without shortening an existing lease, once half the requested TTL remains. Early calls leave expiry and activity unchanged. Batch renewal validates every requested claim before changing any expiry, and records one activity event for the batch. Expired leases cannot be revived; after cleanup their IDs return `CLAIM_NOT_FOUND`.
- **Resources:** `kind:name`; the kind is lowercased. File/directory paths normalize separators, repeated slashes, `.` and internal `..`, and reject absolute or escaping paths. Path case and named-resource case are preserved. Claims match exact normalized strings; directory/file hierarchy and filesystem symlinks are not resolved.
- **Context:** read before changing. A missing context returns `PROJECT_NOT_FOUND`; initialize with `expectedVersion: 0` to create version 1. Existing updates increment only when the expected version matches. A conflict includes `actualVersion`; reconcile after rereading.
- **Decisions:** append new decisions and explicitly supersede an active predecessor in the same project. A predecessor can have only one successor. A stale attempt returns `DECISION_CONFLICT`. Status changes, the new decision and both events commit together.
- **Activity:** append-only. Every successful mutation writes its semantic event in the same transaction. Newest first, with insertion order breaking timestamp ties. `since` is inclusive; deduplicate by event ID when polling. This is a bounded recent feed, not a complete replay/pagination protocol. Expiration events identify the original lease owner.

Memories persist until explicitly deleted; context, decisions and activity persist indefinitely. Memory updates replace content in place and deletion removes the record and its search entry; there is no memory revision archive or undo API. `memory.updated` and `memory.deleted` activity records retain IDs, versions and actors, without copying the removed content. Existing memories are preserved during migration and begin at version 1. Agent IDs are self-reported identities, not authentication. The daemon accepts loopback access, validates Host/Origin and inputs, uses parameterized SQL, and exposes neither SQL nor filesystem access. There are no accounts, agent scheduling, background workers, cloud services or web UI.

## Implementation

```text
HTTP / MCP → application services → repository interfaces → bun:sqlite
```

`application.ts` wires one set of services and repositories. `domain/contracts.ts`
defines transport schemas and inferred types; SQLite rows and SDK responses are
validated at their respective boundaries. Single and batch acquisition share
`ClaimService.acquireMany()`. Transactions cover each domain mutation and its
events. SQL migrations are imported as text and bundled into the standalone binary.
Migration 4 builds the decision text index from existing records without changing
their identity or supersession history.

The tests cover domain transitions, transaction rollback, HTTP boundaries, all MCP tools/resources on the pinned protocol, stdio/HTTP shared state, independent process coordination, persistence/restart and rejection of a second database owner.

## Repository development

Start with [AGENTS.md](AGENTS.md) and the relevant
[development contracts](docs/development.md). This repository uses Agent Baseline
for maintained guidance and evidence drift, and agent-memory for discoveries,
decision history, and coordination. Their [joint workflow](docs/agent-instructions.md#working-in-this-repository)
keeps repository rules canonical and shared context concise.

With uv and Python 3.11+ available, `bun run baseline:check` checks evidence
freshness; `bun run baseline:verify` also validates guidance and runs the existing
application checks. See the development contracts for prerequisites and drift
review before recording a new baseline.

Reusable agent instructions: [docs/agent-instructions.md](docs/agent-instructions.md).

The maintained [shared-agent-memory skill](skills/shared-agent-memory/SKILL.md)
keeps the entrypoint short and routes operation details to references. To install
or update the skill locally while preserving existing UI metadata:

```sh
mkdir -p ~/.codex/skills/shared-agent-memory
cp -R skills/shared-agent-memory/. ~/.codex/skills/shared-agent-memory/
```

Implementation references: [Bun SQLite](https://bun.com/docs/runtime/sqlite), [SQLite FTS5 synchronization](https://www.sqlite.org/fts5.html#external_content_tables), [SQLite exclusive WAL](https://www.sqlite.org/walformat.html), [MCP web-standard serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/web-standard.md), [MCP stdio serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md), [MCP protocol versions](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).
