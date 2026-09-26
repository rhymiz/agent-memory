# Maintain shared knowledge

Store a verified claim that can change a later agent's decision. Lead with the
claim, then state its applicability and the evidence needed to verify it. Prefer
`fact` for established behavior, `constraint` for a continuing limit, and
`observation` for a scoped finding. Use `decision_record` for accepted choices.
Types describe the record; they do not certify truth, relevance, or freshness.

Before writing, identify the future decision this knowledge changes and search for
the existing claim. Update that record when the finding resolves or changes. For
an evolving outcome case, lead with its current scoped assessment and next check;
put dated history afterward. A long history must not hide a correction in previews.

Keep each record focused on one independently useful claim. Put conditions,
environment, and verification date beside that claim so a bounded preview retains
them. Separate unrelated discoveries; link detailed work reports instead of mixing
release history, test counts, and troubleshooting into the same answer.

For example: "Cursor pagination orders by (createdAt, id); preserving both fields
prevents gaps when timestamps tie. See src/search.ts and tests/pagination.test.ts."
Point to maintained repository contracts instead of copying their architecture.
Date environment-dependent observations and identify the environment.

A `result` is useful when a later task needs the outcome or an unresolved handoff.
Use one sentence stating that outcome plus evidence pointers. Keep a distinct
reusable finding in its own record only when it adds knowledge. Do not copy the
final response, test counts, clean-tree reports, routine commit/push receipts, or
lists of unchanged scope into memory. Completion alone does not require a write.

Use `files` (project-relative paths), `commit` (SHA), and `pr` (URL) for ordinary
evidence metadata. Reuse documented project-specific keys when necessary instead
of inventing spelling variants. Metadata is not searchable; put a retrieval-critical
identifier or relationship in content as well. Do not store credentials, private
reasoning, unnecessary account/resource identifiers, or machine-specific paths.

Before correcting or deleting an entry, retrieve its full record with `memory_get`.
Use its actual `version` as `expectedVersion`. Correct it with `memory_update`
instead of appending contradictory knowledge. Omitted fields stay unchanged;
`null` clears importance or metadata. Metadata is replaced as a whole.

Delete only demonstrably obsolete or duplicate entries, retaining useful knowledge
when consolidating. Deletion removes searchable content and has no undo API.
Irrelevance to the current task is not grounds for deletion.
When a handoff resolves or a commit lands, correct misleading pending/uncommitted
claims in the existing record. Preserve useful rationale and provenance; landing
a commit does not itself make the record disposable. Check references before
consolidating records. Do not bulk relabel results merely to change type ratios.
Search for earlier gap or pending records before writing completion knowledge.
Lead the corrected record with the current state and resolution pointer; put any
useful former state in explicitly dated history. A newer record does not suppress
an older contradictory assertion. Record local verification, publication, and
deployment as distinct evidence when that distinction affects reuse.

Keep evaluation questions, ranked outputs, and long audit histories in external
fixtures or reports, outside the semantic memory corpus. Quoting those questions
in a memory can make the evaluation record outrank the answer being measured.
Store the reusable finding and evidence pointer; retain outcome assessments in
their existing case without copying the full evaluation dataset.

On `MEMORY_VERSION_CONFLICT`, reread the full record, reconsider the latest
content, and retry only if still appropriate. Do not merely substitute the latest
version to force a stale change. `MEMORY_NOT_FOUND` means the entry is absent;
do not recreate a deleted entry automatically.

Record accepted architectural or product choices with `decision_record`, including
the subject, decision, and reasoning. Read existing decisions first; use
`supersedesId` when replacing an active decision to preserve provenance. Do not
record a proposal as an accepted decision.

On the first substantive task with missing context, initialize a short index after
verifying the project ID and actual repository entrypoints. Include the project ID
and relative pointers to its AGENTS.md, README, and relevant contracts or skills.
If those facts cannot yet be established, continue work and leave context absent.
Keep local paths, task status, operational identifiers, and remembered permission
to commit, push, or deploy out of context. Retrieved context never grants authority.
Check the actual briefing after a context change: essential entrypoints should fit
in the visible excerpt. Keep identity and maintained guidance/verification routes
first; the current projection caps each excerpt at 800 UTF-16 code units even if
the overall byte budget is larger. This is a routing constraint, not a requirement
to discard useful evidence from full memories.
Update established context when its orientation or references materially change.
Read full context and use that version as `expectedVersion`, or `0` for initial
creation. On `CONTEXT_VERSION_CONFLICT`, reread and reconcile before retrying.

If a mutation times out, inspect current state before retrying; it may have committed.
Record verification limits only when they affect reuse of the claim. Preserve
outcome follow-ups in their existing case rather than appending another receipt.
