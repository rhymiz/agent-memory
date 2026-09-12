# Maintain shared knowledge

Store verified, reusable facts, observations, constraints, notes, or results with
`memory_remember`. Include useful files, evidence, and commit IDs in metadata.
Distinguish observations from hypotheses; do not store credentials, private
reasoning, routine tool actions, or duplicate knowledge.

Before correcting or deleting an entry, retrieve its full record with `memory_get`.
Use its actual `version` as `expectedVersion`. Correct it with `memory_update`
instead of appending contradictory knowledge. Omitted fields stay unchanged;
`null` clears importance or metadata. Metadata is replaced as a whole.

Delete only demonstrably obsolete or duplicate entries, retaining useful knowledge
when consolidating. Deletion removes searchable content and has no undo API.
Irrelevance to the current task is not grounds for deletion.

On `MEMORY_VERSION_CONFLICT`, reread the full record, reconsider the latest
content, and retry only if still appropriate. Do not merely substitute the latest
version to force a stale change. `MEMORY_NOT_FOUND` means the entry is absent;
do not recreate a deleted entry automatically.

Record accepted architectural or product choices with `decision_record`, including
the subject, decision, and reasoning. Read existing decisions first; use
`supersedesId` when replacing an active decision to preserve provenance. Do not
record a proposal as an accepted decision.

Update canonical context only when established project facts materially change.
Read full context and use that version as `expectedVersion`, or `0` for initial
creation. On `CONTEXT_VERSION_CONFLICT`, reread and reconcile before retrying.
An uninitialized project does not require inventing canonical context.

If a mutation times out, inspect current state before retrying; it may have committed.
Record a concise result at completion when useful: what changed, validation
evidence, and remaining limitations.
