# Shared memory and coordination contract

Use the daemon's REST endpoint at `http://127.0.0.1:8787` or MCP at `/mcp`.
The maintained agent workflow is the repository's
[shared-agent-memory skill](../skills/shared-agent-memory/SKILL.md), which routes
to retrieval, claim, and knowledge-maintenance details only when needed.

Suggested repository instruction:

> Before significant project work, use the shared-agent-memory skill to retrieve
> context and coordinate shared edits. Follow explicit project identity and
> ownership rules. Skip trivial standalone tasks.

The daemon owns its database. Shared context is evidence to verify against current
source. Read-only retrieval does not acquire ownership; edits require the relevant
claims. Record reusable findings when they add knowledge and release owned claims
at completion; routine success alone does not require a memory.

Missing canonical context is a valid uninitialized state. During substantive work,
initialize a short index once identity and repository references are verified.
Coordination does not
add a review or approval stage to work the user has already authorized.

## Working in this repository

Use project ID `agent-memory`. Maintained engineering rules live in
[AGENTS.md](../AGENTS.md) and [development contracts](development.md), with API
behavior in the [README](../README.md). Agent Baseline tracks their supporting
evidence. Shared memory stores discoveries, decision rationale, verification
results, and ownership; retrieved entries are checked against current source.

Keep canonical project context a short index to those repository files. Avoid
copying the complete guidance, transient test results, or local deployment status
into it. Exclude local paths and stored commit/push/deploy authorization. An
accepted decision in memory preserves rationale; when it changes a
repository rule, update the maintained rule in the same authorized work. Report
any disagreement between a memory and a contract rather than silently treating
the newer timestamp as authority.

For ordinary code work, retrieve only task-relevant context and read the affected
contract. Prefer a bounded `project_briefing` when available, requesting decisions
for architecture work; expand relevant omissions and full records before mutation.
Use the skill's fallback reads when the connected client does not expose briefings.
Claims and version checks remain separate atomic operations.

Include relevant [outcome follow-ups](outcome-tracking.md) in that retrieval when
the task touches a previously changed workflow. Their next-check triggers identify
when ordinary work can supply evidence; they do not authorize unrelated work.

When a discovery warrants a durable rule:

1. Save the observed behavior and evidence in memory, distinguishing it from a
   proposed policy. Include relevant repository paths and evidence pointers;
   include verification limits only when they affect reuse of the finding.
2. Within authorized guidance maintenance, use
   [baseline-project](../.agents/skills/baseline-project/SKILL.md) to inspect the
   relevant contract and assertions. Update or affirm the repository rule, its
   supporting authority, and an executable check or observable review criterion.
   State missing coverage explicitly.
3. Review and record the affected baseline evidence, then verify it as described in
   [development](development.md#verification). Save the result and canonical path
   back to the relevant memory; preserve useful rationale without a competing copy
   of the rule. Refresh project context only if its orientation or pointers changed.
4. If the change aims to improve agent work, keep an outcome follow-up pending until
   its stated criterion is assessed on a comparable task. Link that assessment to
   the original finding and change, including contrary or inconclusive evidence.

This is an agent workflow, not an automatic database-to-file synchronization.
Baseline checks neither query nor mutate the shared daemon. Memory retrieval does
not certify repository evidence freshness or run baseline commands automatically.

## Skill locations

The repository maintains `skills/shared-agent-memory`; its project discovery entry
at `.agents/skills/shared-agent-memory` is a relative symlink to that directory.
Edit the canonical files. Project work loads this copy explicitly through AGENTS.md,
so it does not depend on a possibly older user-level installation.

Baseline's bundled skill is installed in `.agents/skills/baseline-project` with a
managed installation receipt. Keep repository-specific instructions in the files
above, preserving the installed bundle for future managed upgrades. A CLI upgrade
does not upgrade installed skill copies. Global installations and other repositories
have their own update lifecycle.

The managed bundle and verification commands use Agent Baseline 0.4.0. Its receipt
records the installed file hashes. Upgrade the CLI pin and managed skill together,
review affected guidance, then record and verify the new evidence.
