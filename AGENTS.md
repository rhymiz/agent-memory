# Agent Memory development

This repository builds a local Bun daemon and TypeScript client. Read the relevant
[development contracts](docs/development.md) before changing a domain boundary.
The [README](README.md) documents the public API and runtime setup.

## Engineering rules

- Model reusable domain concepts instead of accumulating one-off fields or tables.
- Keep test-only branches out of production code; inject test dependencies through
  the existing application interfaces.
- Preserve type information across internal boundaries. Validate unknown input,
  SQLite rows, and client responses at their respective boundaries.
- Keep imports at module scope and do not use casts to bypass contract errors.
- Look up version-matched documentation for uncertain APIs.
- Return complete, typed domain data through both HTTP and MCP. Consumers should
  not repair backend shapes or decode stored JSON.

These are repository owner policies. The development contracts connect them to
implementation evidence, existing assertions, and review criteria where automated
coverage is incomplete.

## Shared context and ownership

Use project ID `agent-memory` across clients and worktrees. Before significant
project work, load the repository's
[shared-agent-memory skill](skills/shared-agent-memory/SKILL.md) and actually
retrieve context, relevant memories, recent activity, and claims. A focused
briefing can supply these reads; follow any explicit separate-call requirement.
Include decisions when architecture or product direction matters.

Acquire ownership for the current work phase with the daemon default TTL and
claim the exact files being edited. Follow the returned `renewAfter`, renew the
owned set in one call when due, record useful results, and release owned claims.
Skip this workflow for trivial standalone questions. Follow the skill's identity,
conflict, and connection-failure rules.

Repository guidance holds maintained rules; shared memory holds discoveries,
decision history, and coordination. Keep project context a short index to these
files. Use the [joint workflow](docs/agent-instructions.md#working-in-this-repository)
when a discovery warrants a lasting rule.

For durable friction, a change intended to improve agent work, or a matching
follow-up found during retrieval, use [outcome tracking](docs/outcome-tracking.md).
Keep the finding, change, next verification trigger, and observed result linked;
applying a change or passing baseline checks alone does not establish improvement.

## Guidance maintenance and checks

Use [baseline-project](.agents/skills/baseline-project/SKILL.md) for requested
guidance setup, audit, or refresh. Ordinary feature work reads the relevant rules;
it does not trigger a repository-wide guidance rewrite.

`bun run check` runs formatting, strict typing, and the application tests.
`bun run baseline:verify` checks recorded evidence and guidance, then runs that
same suite once. See [verification](docs/development.md#verification) for setup,
drift review, and packaging checks. A passing baseline does not prove architecture
quality, live daemon deployment, or automatic skill selection.
