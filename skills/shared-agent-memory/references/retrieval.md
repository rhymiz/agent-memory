# Retrieve and expand

`project_briefing({projectId, query})` returns bounded `context`, `memories`,
`claims`, and `activity` collections. Supply `sections` to select only needed
collections, adding `decisions` for architectural or product work. Decisions are
recent active project decisions, not ranked by the query. Activity excludes lease
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

`maxBytes` caps one serialized UTF-8 JSON data payload, excluding the MCP envelope
and its text/structured duplication. Default budgets are 12000 for compact search
and 20000 for a briefing. Raise the budget or narrow sections when needed.

If these tools are unavailable, retrieve `project_context_get`, focused
`memory_search` (small limit), `activity_recent` (small limit), and `claims_list`.
Those reads can run together. Use `decisions_list` when relevant. A missing-context
error does not require creating canonical context merely to complete startup.
