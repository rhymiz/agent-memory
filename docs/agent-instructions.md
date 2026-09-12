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
claims. Record useful results and release owned claims at completion.

Missing canonical context is a valid uninitialized state. Coordination does not
add a review or approval stage to work the user has already authorized.
