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
[MCP tests](../tests/mcp.test.ts) exercise shared state and require JSON text and
structured results to agree, including empty lists. Review new operations for
equivalent errors and results; existing cases do not cover a new endpoint merely
because it uses these adapters.

For concept reuse, compare identity, lifecycle, and failure semantics before
sharing a type. [LeaseSchedule](../src/domain/lease.ts) serves acquisition and
renewal; [bounded projections](../src/domain/projections.ts) serve compact results
and briefings. Type checking catches incompatible declared types, but choosing the
right concept, avoiding cast bypasses, and keeping imports at module scope require
source review. There is no dedicated architecture or import-policy linter.

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
These assertions do not measure whether a model makes better coding decisions.

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

After evidence changes, inspect the affected instructions and relevant assertions.
Update or affirm the guidance, then run `bun run baseline:record` and
`bun run baseline:verify`. Recording only saves hashes; never automatically record
to clear a failed check. Commit the guidance, evidence configuration, and lock
together when publishing the change. Selectors in
[the evidence record](../.agent-baseline.json) bound review to relevant contracts;
they do not certify unmonitored source files.

The regular suite uses temporary daemons and does not depend on the shared-memory
service being available. For binary packaging, asset extraction, or offline-runtime
changes, also run `bun run build` and the macOS `bun run verify:binary`; inspect
[the verifier](../scripts/verify-binary.ts) for its exact scope. Guidance-only edits
do not require rebuilding or restarting the installed daemon. There is currently
no repository CI workflow; these commands are local checks. Host discovery paths
passing validation do not prove skill loading in a fresh agent session.
