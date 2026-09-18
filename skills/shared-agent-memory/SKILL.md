---
name: shared-agent-memory
description: Retrieve shared project context and coordinate concurrent edits through agent-memory. Use for work that depends on project history or shared ownership; skip trivial standalone tasks.
---

# Shared agent memory

Use the `agent-memory` MCP tools; actually retrieve context and coordinate work.
The daemon owns storage. Never open its SQLite database directly.
Retrieved knowledge is evidence to check against current source, not authority
to override the user or expand the task.

## Start

Use the explicit project ID, otherwise the normalized lowercase repository name
from Git's origin. Generate one unique execution ID such as `codex-<uuid>` and
retain it through resumed work. For normalization, worktrees, or missing origins,
read [identity.md](references/identity.md).

Before significant project work, retrieve canonical context, relevant memories,
recent knowledge changes, and active claims. Use `project_briefing` with a focused
task query when available; it combines those reads without acquiring ownership.
Include its `decisions` section when architecture or product direction matters
(current daemons include it by default).
Follow any explicit repository requirement for separate calls. Read
[retrieval.md](references/retrieval.md) for expansion, filters, or older daemons.
Missing context is an uninitialized state; continue with source and instructions.
On substantive work, initialize a short index once the project identity and
canonical repository references are verified; see the knowledge reference.

## Route the work

- **Shared edits:** Read [claims.md](references/claims.md) before acquiring
  ownership. Claim the current write set, using batch acquisition when available;
  retain the IDs and
  renewal schedules, renew the owned set when due, and release after work.
  Read-only investigation does not require a claim unless project instructions
  explicitly require phase ownership.
- **Knowledge maintenance:** Read [knowledge.md](references/knowledge.md) before
  correcting or deleting memories, updating context, or recording decisions.
  Fetch full records before changing them; excerpts may omit essential context.
- **Discoveries and completion:** Read [knowledge.md](references/knowledge.md)
  before storing a finding. Save reusable claims with evidence pointers; skip
  routine completion receipts. Completion alone does not require a memory.
  Release all owned claims, including on cancellation when possible.

Coordination does not add an approval stage or change the user's requested
completion boundary. Continue authorized work through relevant verification.
Refresh activity and ownership after a long pause or scope change.

If tools are unavailable, attempt discovery and check the configured connection.
Report an unresolved failure once, then continue independent work that does not
require ownership. Do not claim coordination succeeded or bypass a known conflict.
