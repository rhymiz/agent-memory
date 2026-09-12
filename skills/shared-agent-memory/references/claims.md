# Own and renew work

Before editing shared project files, acquire each actively needed file in sorted
order with `claim_acquire({projectId, agentId, resource, intent})`. Use resources
such as `file:src/services/search.ts`, with project-relative `/` paths, no leading
`./`, and no traversal. Do not preclaim a future plan.

Feature, directory, schema, and architecture claims match exact strings; they
do not protect child file paths. Agree on shared scopes for coordinated work.
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

Release owned claims with `claim_release({claimId, agentId})` when finished,
including on cancellation when possible; remove released IDs from the work set.
TTL expiry handles crashes, not normal cleanup. Refresh ownership after interruption.

A timeout may follow a committed mutation. Inspect current state before retrying
a write; appends have no idempotency key. Report success only after a successful
response or confirming read.
