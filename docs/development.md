# Development contracts

The engineering rules in [AGENTS.md](../AGENTS.md) are owner policy. The
[domain guarantees](../README.md#domain-guarantees) describe the maintained
behavior. The mappings below identify current evidence and verification limits.

## Boundaries and ownership

HTTP and MCP call the same services assembled in
[application.ts](../src/application.ts). Services own domain transitions;
repository interfaces and [SqliteStore](../src/repositories/sqlite-store.ts) own
persistence. For a new operation, trace request validation, service behavior,
transactional writes, and returned data across both transports. Avoid implementing
a second transition in a transport adapter.

[contracts.ts](../src/domain/contracts.ts) provides strict schemas and inferred
types. [HTTP parsing](../src/api/router.ts), MCP tool schemas, SQLite row parsing,
and [client response validation](../src/client/memory-client.ts) are the unknown
data boundaries. Keep parsed metadata and domain response shapes ready for callers.
[HTTP tests](../tests/http.test.ts) reject malformed and unknown fields;
[MCP tests](../tests/mcp.test.ts) exercise both supported protocol versions,
2026-07-28 and 2025-06-18, and require successful JSON text and structured results
to agree, including empty lists. Domain tool failures use `isError: true` and JSON
text preserving the HTTP error code and details, without `structuredContent`:
some clients otherwise validate errors against the successful output schema.
MCP tests cover invalid claim resources, ownership failures, and stale memory and
context versions through this error path. [Process tests](../tests/process.test.ts) exercise both
stdio handshakes against the same HTTP-visible state. Protocol selection belongs
to the SDK serving boundary; tools and domain services stay shared. Review new operations for
equivalent errors and results; existing cases do not cover a new endpoint merely
because it uses these adapters.

For concept reuse, compare identity, lifecycle, and failure semantics before
sharing a type. [LeaseSchedule](../src/domain/lease.ts) serves acquisition and
renewal; [bounded projections](../src/domain/projections.ts) serve compact results
and briefings. Type checking catches incompatible declared types, but choosing the
right concept, avoiding cast bypasses, and keeping imports at module scope require
source review. There is no dedicated architecture or import-policy linter.

## Deployment modes and authorization

The daemon and the [hosted service](../README.md#hosted-service-on-cloudflare)
compose the same application. Runtime differences belong in the composition roots
([index.ts](../src/index.ts), [worker.ts](../src/cloudflare/worker.ts)) and their
adapters: a `SqliteStore` driver, an `EmbeddingModel`, and a `RequestPolicy`.
Shared modules must not use Bun or Workers globals; IDs come from the portable
generator in [ids.ts](../src/domain/ids.ts). [tsconfig.json](../tsconfig.json)
checks the binary, tests and shared code with Bun types;
[tsconfig.worker.json](../tsconfig.worker.json) checks the Worker against generated
runtime types. `bun run typecheck` runs both. [Handler tests](../tests/handler.test.ts)
cover the shared body limit, policy rejection and response headers.

Drivers report changed rows with `changes()`, excluding trigger writes, and return
BLOBs as `Uint8Array`. The Durable Object driver joins nested units to the outer
`transactionSync()`; code must not catch an inner unit's failure and continue.

`ProjectAccess` is injected per request and checked by each service before any
project read or write, so HTTP routes, MCP tools and MCP resources share one
decision. A new project-scoped service method needs the same check. Claims outside
the grant are reported as missing. Inspection lists only granted projects and
requires `projectId` for restricted callers.

Every hosted caller is a `Principal`: an account, a credential ID and a grant. API
keys resolve to one through the credential registry, passed to the OAuth provider's
`resolveExternalToken`. OAuth tokens carry only a member reference and approved
scopes ([sign-in.ts](../src/api/sign-in.ts) `memberTokenProps`); the Worker reads
the member on every request, so revocation is immediate and scopes can only narrow
the member's grant (`grantForScopes`). Do not put grants in token props or make
scopes widen a grant. Sign-in completes authorization only for an active member
resolved by provider and numeric subject, never by login.

[Gateway tests](../tests/gateway.test.ts) compose the real credential service,
gateways and per-account applications over Bun SQLite. They cover invalid, revoked
and expired keys, throttled last-use updates, administrator authentication,
read-only keys, ungranted projects over HTTP and both MCP protocol versions,
cross-account isolation with matching project IDs, inspection filtering, and rate
limiting. Removing the access check or the revocation check fails them.
[Member tests](../tests/members.test.ts) cover member administration and conflicts,
sign-in resolution by subject, scope narrowing (including a write scope on a read
member), immediate revocation of existing tokens, and MCP use; a token table in
[hosted-helpers.ts](../tests/hosted-helpers.ts) stands in for the OAuth provider's
token validation. [Sign-in tests](../tests/sign-in.test.ts) drive the consent,
GitHub and callback steps against recording fakes: escaping of client-supplied
text, PKCE challenge derivation, chosen scopes, denial, non-member refusal and
generic failures. [Workers AI model tests](../tests/workers-ai-model.test.ts) cover
chunk bounds, batching, prompts and output validation with a recorded runner only.

No automated test covers the OAuth provider library itself (metadata, dynamic
registration, token issuance and refresh, KV storage, `resolveExternalToken`
wiring), the real GitHub token exchange, the Durable Object driver, Workers AI
output, RPC transfer of `Request`/`Response`, rate-limit bindings or alarm
scheduling. Exercise them against a deployment; Bun tests do not establish their
behavior.

The production hostname, Cloudflare account ID and secrets are supplied at deploy
time (`AGENT_MEMORY_DOMAIN`, `CLOUDFLARE_ACCOUNT_ID`, `wrangler secret put`). No
check enforces this; before committing, confirm that `wrangler.jsonc` has no
`routes`, `route` or `account_id` and that no committed file names the production
hostname.

## Persistence and concurrency

Keep each mutation, its activity events, and affected search indexes atomic.
[MemoryService](../src/services/memory-service.ts) computes embeddings before the
write transaction and rechecks the observed version inside it. A failed inference
or stale correction must not partially commit or resurrect deleted memory.
[Mutation tests](../tests/memory-mutations.test.ts) assert rollback and one winner
for simultaneous corrections; [semantic tests](../tests/semantic.test.ts) also
check vectors, delayed inference, and deletion races.

Claims match exact normalized resources, not directory descendants or filesystem
locks. Use the shared lease schedule; renewal validates the complete batch before
changing any expiry. [Claim tests](../tests/claim-renewal.test.ts) assert the
midpoint deadline, unchanged state on early renewal, atomic failure for invalid
members, and one event for a successful batch. [Domain tests](../tests/domain.test.ts)
cover project isolation, exact expiry, context version conflicts, and decision
supersession rollback.

The running daemon owns its SQLite database. Development tests use temporary
databases through [fixtures](../tests/helpers.ts), injecting clocks and embedding
models through production interfaces. Keep test doubles in tests, without
production test-mode branches. Review any new dependency seam for ordinary runtime
meaning. [Process tests](../tests/process.test.ts) assert rejection of a second
database owner and persistence across restart; they do not inspect the user's live
database.

## Retrieval and response limits

Preserve full search when changing compact projections. Budget the serialized
UTF-8 JSON data object and expose omission and truncation separately. Excerpts are
verbatim; briefings are bounded orientation views rather than atomic snapshots or
ownership grants. [Compact-search tests](../tests/compact-search.test.ts) check
rank preservation, Unicode budgets, and unchanged full records.
[Briefing tests](../tests/briefing.test.ts) check every section's total budget,
optional reads, uninitialized context, and knowledge visibility despite lease churn.
Excerpts retain leading scope and prefer sentence/line boundaries; they can still
omit later qualifications and require expansion. Briefing activity retains event
identity and references but substitutes the event message/type when the same
knowledge version is already represented. The tests cover repeated revisions,
activity-only reads, and records excluded from the memories section.
These assertions do not measure whether a model makes better coding decisions.

Memory filters are one shared contract used by full search, compact search,
briefings, and operator listing. Apply them to both lexical and semantic candidate
selection before ranking and limits. [Filter tests](../tests/search-filters.test.ts)
place a relevant record behind more than one candidate window of excluded records,
check corrected timestamps and unscored importance, and compare HTTP/MCP results.
Filters are optional; types and self-assigned importance do not establish quality.

Decision lookup indexes subject, decision, and reasoning with FTS5; it is lexical,
not semantic. Query matching precedes the limit and defaults to active decisions.
Briefings include matching decisions by default. [Decision search tests](../tests/decision-search.test.ts)
cover older matches, supersession, scope, migration backfill, and rollback.

Operator reads live in [InspectionService](../src/services/inspection-service.ts).
Statistics read all aggregates in one transaction and distinguish active from
expired leases without cleanup. Project/memory pages use ascending keyset cursors;
multiple pages are not an atomic export. [Inspection tests](../tests/inspection.test.ts)
cover projects represented outside memories, deleted cursor records, scoped counts,
current embedding coverage, and transport validation. Never bypass the running
daemon by opening or copying its SQLite/WAL files.

Batch acquisition normalizes and validates every resource before committing any
ownership, using the same transition as single acquisition. Release validates all
members before deletion. [Batch tests](../tests/claim-batches.test.ts) cover conflicts,
duplicate paths, concurrent batches, foreign/expired members, event rollback, and
per-resource audit references in compact events. Directory hierarchy remains
unsupported. The practical claim-size criterion is correspondence with actual
writes, including generated outputs where shared; counts alone cannot establish it.
Acquisition advisories use the same typed response across HTTP and MCP. The size
prompt counts this agent's active project claims after acquisition, excluding
expired leases and other owners/projects. The generated-path prompt is a literal
directory-name heuristic, not filesystem inspection. Tests cover the 100/101
boundary, release, expiry, scope, normalized paths, and transport envelopes.

The [knowledge guidance](../skills/shared-agent-memory/references/knowledge.md)
requires a reusable claim, applicability, and evidence pointers. Review a proposed
memory for those properties and for correction of an existing record before adding
one; automated schema checks cannot establish its usefulness. The read-only
`bun run retrieval:evaluate` runner accepts judged question/record pairs as described
in the [README](../README.md#knowledge-maintenance-and-inspection).
[Evaluator tests](../tests/retrieval-evaluation.test.ts) prove that missing answers
and stale hits are measured independently of record type. They exercise actual
full/compact/briefing HTTP reads, hidden qualifications, corrected leading text,
forbidden context text, unrequested sections, decision reasoning omissions,
version drift, explicit empty judgments, and project isolation. The evaluator's
evidence checks validate caller-supplied exact phrases in one record; they do not
judge truth or semantic completeness. Inputs and private cases remain external;
production retrieval has no evaluation-specific branches or project heuristics.
Later comparable task evidence is still required to grade the guidance outcome.

## Verification

Use Bun as specified in [package.json](../package.json). For a fresh checkout, run
`bun install --frozen-lockfile` and `bun run model:download`; real inference and
process tests need the pinned local model assets. The formatting and TypeScript
CLI scripts also need a configured Node runtime. Baseline commands additionally
require uv and Python 3.11+. They use released `agent-baseline==0.4.0`, independent
of another checkout or a globally installed skill.

- `bun run baseline:doctor` checks linked guidance and Codex project discovery paths.
- `bun run baseline:check` reports drift without running project commands.
- `bun run baseline:verify` rejects drift, validates guidance, runs `bun run check`
  once, and rejects changes to monitored inputs during verification.

`bun run typecheck` regenerates the ignored `worker-configuration.d.ts` with
`wrangler types` before checking both targets. For Worker or binding changes, also
run `bun run cf:build`, which bundles the Worker without uploading it; it does not
exercise the Workers runtime. Deployment (`cf:deploy`) and key administration
(`admin`) use credentials and are never part of the check list.

After evidence changes, inspect the affected instructions and relevant assertions.
Update or affirm the guidance, then run `bun run baseline:record` and
`bun run baseline:verify`. Recording only saves hashes; never automatically record
to clear a failed check. Commit the guidance, evidence configuration, and lock
together when publishing the change. Selectors in
[the evidence record](../.agent-baseline.json) bound review to relevant contracts;
they do not certify unmonitored source files.

The regular suite uses temporary daemons and does not depend on the shared-memory
service being available. For binary packaging, asset extraction, or offline-runtime
changes, also run `bun run build` and `bun run verify:binary` on macOS or Linux; inspect
[the verifier](../scripts/verify-binary.ts) for its exact scope. Guidance-only edits
do not require rebuilding or restarting the installed daemon.
Linux CI in [.github/workflows/release.yml](../.github/workflows/release.yml)
runs native x64 and ARM64 application, packaging, and installer checks. Linux
offline verification requires `bubblewrap`, `curl`, and user/network namespaces;
it fails rather than silently skipping isolation when those are unavailable.
[Installer tests](../tests/install.test.ts) exercise architecture selection,
pinned downloads, checksum rejection, and preservation of an existing binary.
The release jobs additionally install and execute the actual compiled artifact.
Tag publication requires both architectures to pass and a tag matching the package
version. Local checks alone do not prove a published release. Host discovery paths
passing validation do not prove skill loading in a fresh agent session.

## Plugin distribution

The canonical skill is inside [plugins/agent-memory](../plugins/agent-memory/README.md).
The former `skills/shared-agent-memory` path remains a symlink, preserving existing
repository routing without a second guidance copy. Packages must be self-contained:
no links outside the bundle, user configuration, credentials, project IDs, databases,
or model assets. Native host manifests adapt loading only; all hosts share the same
skill and HTTP endpoint. Portable MCP uses `streamable-http`; compatibility
configuration uses `http`. Both target the same running daemon.

[Package tests](../tests/plugin-package.test.ts) unpack both release archives away
from the checkout and check complete skill/reference content, host manifests,
equivalent MCP endpoints, checksums, version agreement, and rejection of symlinks.
Review format changes against the official sources in the plugin README and run
installed native validators. Fresh host trials must identify the bundled skill
and complete a memory read; archive validity alone does not establish host support
or correct agent behavior. Keep host transcripts and task-specific prompts outside
the distributed package and record verification limits in release evidence.
For client compatibility changes, include a native headless read using the
documented permissions and a recoverable error in an isolated project. Check the
model-visible error and successful recovery, not just the process exit status.
For upgrades, verify the selected source and version after restarting discovery;
one visible skill can conceal another installation with the same name.

`bun run plugin:build` builds guidance archives without the model. The separate
[plugin workflow](../.github/workflows/plugins.yml) verifies those archives and
publishes `plugin-v<version>` tags. Plugin versions must match across manifests;
the documented minimum daemon version is a separate compatibility contract.
Publication uses `--latest=false` so the Linux installer's latest-release lookup
continues to resolve a daemon release. New clients can use the portable package or
the standalone skill and their native MCP configuration; do not infer support
from an untested host name.
