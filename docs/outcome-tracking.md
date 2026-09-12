# Outcome tracking

Use the bundled [outcome procedure](../.agents/skills/baseline-project/references/outcomes.md)
for durable friction, substantive changes intended to improve agent work, and
matching follow-ups during later tasks. It supplies the case format, assessment
criteria, evidence history, and coverage rules. Routine successes and one-off
preferences do not need a case.

## This repository's configured store

Use existing `observation` memories in project `agent-memory`, with the current
execution identity from the
[shared-memory skill](../skills/shared-agent-memory/SKILL.md). The shared daemon is
the active outcome store; the generic procedure is packaged by agent-baseline.
This adapter supplies the repository's operations without duplicating that
procedure or introducing a new API record type.

- **Find a case:** use `memory_search` with `projectId: "agent-memory"`, a small
  `limit`, and a query combining `Outcome follow-up` with the affected path,
  workflow, or finding. Inspect the returned content and type; search has no type
  or assessment filter. Include matching cases in task-start retrieval.
  Follow the [retrieval rules](../skills/shared-agent-memory/references/retrieval.md)
  when expanding bounded results or using a briefing or compact search.
- **Read and create:** use `memory_get` with `projectId` and `memoryId` for the full
  matching record. Reuse it when
  relevant; otherwise use `memory_remember` with type `observation`, the project
  ID, and current execution identity. Fill the bundled case format with actual
  evidence and a concrete next-task criterion. Put its searchable title and
  assessment in content; metadata is not embedded or a supported status filter.
- **Update:** retrieve the full current record, then use `memory_update` with
  `projectId`, `memoryId`, the current `agentId`, its `expectedVersion`, and the
  revised content. On conflict, reread and reconcile. Preserve the original
  finding, change references, and useful assessments: updates replace content,
  and the activity feed does not archive it. Follow the
  [knowledge rules](../skills/shared-agent-memory/references/knowledge.md) for
  metadata replacement and obsolete knowledge.

Link the original finding, any accepted decision, and a separate implementation
result by memory ID; link the maintained rule by repository path. Case content is
observational evidence. New lasting rules follow the
[baseline refresh workflow](agent-instructions.md#working-in-this-repository).
A passing suite does not grade the producing workflow as improved.

State the records, revisions, and runs actually inspected. Bounded search results
or activity feeds cannot establish that every follow-up was assessed. If the
configured service is unavailable, follow the shared-memory failure handling and
bundled storage fallback rules, making any temporary active location explicit;
never claim an unperformed read or write succeeded.
