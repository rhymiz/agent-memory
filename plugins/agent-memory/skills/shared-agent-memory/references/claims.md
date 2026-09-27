# Own and renew work

Before editing shared project files, acquire the current write set with
`claims_acquire({projectId, agentId, resources, intent})` when available. It returns
all claim IDs and one renewal schedule; a conflict rejects the entire batch.
Normalized duplicate resources are invalid. For one file or an older daemon, use
`claim_acquire({projectId, agentId, resource, intent})` in sorted order. Use resources
such as `file:src/services/search.ts`, with project-relative `/` paths, no leading
`./`, and no traversal. Do not preclaim a future plan.

Claim what this phase will write, not every file discovered or read. Include
lockfiles and generated files when a command actually modifies shared copies;
use isolated output directories for disposable build artifacts when possible.
For large batches, compare the resources with the command's expected write set.
A large count alone does not establish unnecessary ownership.
Acquisition advisories flag more than 100 simultaneous resources owned by one
agent in one project, and paths containing a directory named `generated`.
Compare them with the intended writes and release unused claims. These are
non-blocking review prompts, not proof that the claims are wrong. Older daemons
may omit advisories.

Feature, directory, schema, and architecture claims match exact strings; they
do not protect child file paths. Agree on shared scopes for coordinated work.
Use `phase:` or `feature:` as an explicitly agreed work-stream mutex only; retain
file claims for shared writes. A repository may separately require phase ownership.
Listing claims is advisory; acquisition is the atomic ownership check.

On `CLAIM_CONFLICT`, inspect the owner and intent, then work on independent scope
or wait for release/expiry. Do not release another agent's claim or rename the
resource to evade a conflict. Release unneeded claims if a conflict blocks progress.

Omit `ttlSeconds` for the configured default, normally 30 minutes. Save the
returned claim ID and `schedule` containing `renewAfter` and `expiresAt`.
On an older daemon without a schedule, the first deadline is
`createdAt + (expiresAt - createdAt) / 2`.

When the actual wall clock reaches the earliest owned deadline, call
`claims_renew({projectId, agentId, claimIds})` once for the owned set. Cache its
returned `renewAfter` and `expiresAt`; do not loop over single-claim renewals or
renew after every tool call. The operation accepts 1–500 unique IDs. Early calls
make no changes, and no background renewal process should outlive the agent.

Before long operations, ensure the leases cover the work; request a longer TTL
deliberately if needed within the daemon's maximum. If using a TTL override,
retain it with the work set and use the intended TTL on renewal; renewal deadlines
are calculated from the TTL requested for that operation.

A renewal batch is atomic. Any missing, expired, foreign-project, or non-owned
claim rejects the whole batch and identifies the failing ID. Stop edits on the
affected resource, reread claims, and reacquire or remove the lost ID before
retrying. Never continue under an expired lease or assume partial renewal.

Release owned claims with `claims_release({projectId, agentId, claimIds})` when
available, or `claim_release({claimId, agentId})` for one claim or older daemons.
Batch release is atomic and rejects any missing, expired or non-owned member;
reread ownership, remove lost IDs, and release the remaining owned set.
Release on cancellation when possible; remove released IDs from the work set.
TTL expiry handles crashes, not normal cleanup. Refresh ownership after interruption.

A timeout may follow a committed mutation. Inspect current state before retrying
a write; appends have no idempotency key. Report success only after a successful
response or confirming read.
