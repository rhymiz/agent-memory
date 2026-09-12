# Set up and assess guidance outcomes

Use this for substantive changes intended to improve agent work and for assessing
them during subsequent comparable work. Ordinary successes, cosmetic corrections,
and one-off preferences do not need a case. This workflow preserves evidence; it
does not certify improvement or require a new service.

## Configure the consumer's workflow

During authorized setup, complete these choices from the project's actual files,
instructions, and available tools. Preserve an established workflow when it fits.

- **Choose storage.** Reuse an existing project outcome log or an explicitly
  configured shared knowledge store whose read/write operations are available and
  authorized. A tracker mentioned in prose is not an integration. If none exists,
  create `docs/agent-outcomes.md` as a plain Markdown log, adapting the path to an
  existing documentation convention. This fallback needs no package, service, or
  account. Preserve existing content and do not copy cases into a second store.
- **Write the route.** Add a short conditional instruction to the project's
  maintained agent guidance. Fill in the actual storage location, retrieval/update
  method, and a working relative link to this installed reference or a maintained
  project workflow. Check links from the consumer location. For a tool-backed
  store, use its documented search, full-read, identity, and conflict semantics;
  do not invent tool names or an API. For Markdown, read the log and update the
  matching case, preserving other entries and concurrent edits.
- **Prepare the destination.** For a new Markdown log, write a short introduction
  linking its procedure and explaining that cases contain observations, not policy.
  Seed a case from an observed setup finding using the format below, or state that
  no cases have been recorded. Do not leave placeholder cases or fabricate a past
  failure to populate the file. For a working external store, use its existing
  records and create only a useful case.
- **Make it usable.** Verify that the consumer can read the chosen location and
  follow the configured operation or local-file path. If a preferred store is
  unavailable, report the missing coverage and use the Markdown fallback within
  authorized scope, identifying it as the active location. If project policy
  forbids that fallback, leave a concrete proposed route in the completion report
  and state the blocker. Do not claim setup is complete or silently split history.

For a Markdown-backed project, adapt this routing example and resolve its link:

> When a task matches a prior guidance change, read the relevant case in
> `docs/agent-outcomes.md` and its stated acceptance criterion. Record durable
> friction and substantive guidance changes there using the outcome procedure.
> Assess matching cases using the authorized task's evidence; preserve pending or
> inconclusive results when evidence is missing. Routine work needs no new case.

The agent writes the configured instruction and any evidence-backed initial case.
It must not hand the consumer an empty template as unfinished setup work.

## Preserve one linked case

Find an existing case by its affected workflow, path, or original evidence before
creating one. Keep a stable heading or record ID and link the finding, change, and
implementation result. The following is an authoring aid, not a required API schema;
fill it with observed information when creating a case:

```text
Outcome follow-up: <workflow or path> — <specific finding>
Finding: <observed behavior and impact; evidence; useful attempted workaround>
Desired outcome: <observable behavior that addresses the finding>
Change: <planned or applied; canonical guidance and implementation references>
Revision: <commit or explicitly uncommitted state>
Next check: <comparable task trigger and concrete acceptance criterion>
Assessment: pending — <what has not yet been assessed>
Coverage: <sources or runs inspected; omissions and comparison limits>
Evidence history: <dated assessments with small evidence references>
```

Keep hypotheses, plans, and actual changes distinct. Retain original evidence and
useful prior assessments when updating a case. If a store replaces record content,
preserve that history explicitly and use its version/concurrency protections.
Store factual summaries and small references, not raw transcripts or secrets.
Maintained rules stay in canonical guidance; cases link to them without becoming
another policy source.

## Assess subsequent work

When the configured trigger matches an authorized task, read the full case and
compare its criterion with that task's actual artifacts and verification. Record
the revision, relevant environment differences, and evidence supporting the grade.
The trigger does not authorize extra benchmarks, deployment, scheduling, external
messages, or unrelated changes.

- **Pending:** the change or comparable task has not been assessed; retain its trigger.
- **Improved:** evidence addresses the original finding and meets the stated
  criterion. Limit the claim to the observed task and identify comparison limits.
- **Unchanged:** comparable evidence shows the problem persists; keep the case
  actionable and identify the next investigation or change.
- **Regressed:** comparable evidence shows worse behavior or a related new failure;
  reopen the same case without automatically reverting or expanding the task.
- **Inconclusive:** assessment was attempted, but missing evidence or material
  differences prevent a conclusion; explain what would resolve it.

A completed implementation, commit, or green suite is not by itself evidence that
the producing workflow improved. Later contrary evidence can reopen an improved
case. State sources and runs actually checked, requested versus inspected scope,
and missing, unavailable, or truncated evidence. A bounded search with no matches
does not prove every case resolved or an entire time window reviewed.

These are evidence-backed assessments, not automatic grades. Use
[controlled evaluation](evaluate.md) for broader causal or cross-model claims.
