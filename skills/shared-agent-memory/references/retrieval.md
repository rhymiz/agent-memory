# Retrieve and expand

`project_briefing({projectId, query})` returns bounded `context`, `memories`,
`claims`, `decisions`, and `activity` collections. Supply `sections` to select only
needed collections, retaining `decisions` for architectural or product work.
Current daemons rank active decisions by matching words in their subject, decision,
and reasoning. This is lexical retrieval; use concise keywords with
`decisions_list({projectId, query})` to expand it. Omit query to browse recent
decisions. Older daemons require requesting the decisions section explicitly and
return recent decisions without query ranking. Activity excludes lease
events; `since` restricts it to changes at or after that Unix millisecond time.

Each collection has `items` and `hasMore`; each excerpt has `text` and `truncated`.
An empty context collection with `hasMore: false` means none has been initialized.
`hasMore: true` means the collection was cut short by its item or byte budget;
it must not be interpreted as proof that no other knowledge or claims exist.
Expand relevant records with `memory_get`, `project_context_get`, `claims_list`,
or `decisions_list` before relying on omitted details. Claim acquisition remains
the atomic conflict check even when a briefing shows no competing claim.

Use `memory_search_compact` for follow-up retrieval and `memory_get` for full
records. Excerpts are verbatim windows around query terms, or leading text when
only semantic similarity matched. They are not generated summaries. Activity
memory/context excerpts reflect the current referenced version, not a historical
snapshot of the event. Deleted memories have a reference but no recovered content.

When supported, memory search accepts `types`, `updatedSince` (inclusive Unix
milliseconds), and `minImportance`. Briefings accept the same fields inside
`memoryFilter`. Filters apply before ranking to both lexical and semantic candidates.
Leave them unset when completeness matters: useful knowledge may be stored as
`result`, an old constraint may remain valid, and unscored records are excluded by
any importance threshold. A type filter is not a quality filter. Search with a
concrete project concept rather than test/commit boilerplate.

For operator inspection, use `projects_list` and `memory_list`, passing each
`nextCursor` as `after` until it is null. Memory listing returns full records and
accepts the memory filters; use small pages. `corpus_stats` returns a consistent
aggregate read, optionally restricted by project. Pages are current reads, not a
frozen snapshot across calls. Do not open or copy the live SQLite/WAL files to
work around missing tools; report the capability gap on older daemons.

`maxBytes` caps one serialized UTF-8 JSON data payload, excluding the MCP envelope
and its text/structured duplication. Default budgets are 12000 for compact search
and 20000 for a briefing. Raise the budget or narrow sections when needed.

If these tools are unavailable, retrieve `project_context_get`, focused
`memory_search` (small limit), `activity_recent` (small limit), and `claims_list`.
Those reads can run together. Use `decisions_list` when relevant. A missing-context
error does not require creating canonical context merely to complete startup.
