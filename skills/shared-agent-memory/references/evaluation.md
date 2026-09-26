# Maintain and evaluate knowledge

Use this procedure for an authorized corpus review or a change intended to improve
retrieval. Ordinary tasks use the retrieval and knowledge references; they do not
need a corpus-wide audit. Project identities, repository layouts, case questions,
expected answers, and host commands come from the consumer's inspected environment.

## Establish a comparison

Select real task questions and a few unchanged control cases. Read full records
and current authoritative sources to judge useful answers, applicability, stale
assertions, and unresolved questions. Include paraphrases and cases with no known
answer. A relevance list is a human judgment, not a truth label supplied by a type
or importance score. Preserve each judged record's ID and version.

Keep questions, originals, proposed edits, judgments, and reports in an external
audit directory outside semantic memory. Retrieve originals through supported
APIs; a collection of live reads is not an atomic database snapshot. Record the
read window and preserve concurrent-change failures rather than hiding them.

When the agent-memory source checkout is available, run its evaluator there with
an absolute case-file path, independently of the consumer's language or tooling:

```sh
bun run retrieval:evaluate /absolute/path/cases.json http://127.0.0.1:8787
```

The command is read-only and writes a JSON report to stdout. Capture stdout in an
external report file. Its fixture format is documented in the agent-memory README
under Knowledge maintenance and inspection. Full, compact, and briefing responses
are distinct surfaces. Check that the answer and its qualifications remain in the
same record; a correct ID at rank one does not establish that its preview is safe
to use. Exact text checks are mechanical evidence, not semantic grading.

## Correct a bounded set

Use the consumer's ownership rules. Save the full preimage, observed version,
proposed replacement, and evidence for each selected context or memory. Update
through the daemon with that version and reread the result. If the version changed,
reconcile the new content before proceeding. Do not retry a timed-out mutation
until a read establishes whether it committed.

Keep project context an index of identity, authoritative entrypoints, domain-guide
routing, and verification routing. Inspect its actual briefing: essential routing
should be visible. Keep current conclusions and applicability at the beginning of
memories, with evidence pointers nearby. Move long historical reports outside the
searchable record while retaining their reference and any useful contrary evidence.
Correct resolved handoffs in place. Do not delete or relabel records to improve a
type ratio, and do not convert past permission into continuing authority.

Rejudge changed versions explicitly, preserving the old judgments. Run the same
questions after the edits. Inspect lost useful hits, stale assertions, first useful
rank, returned-count precision, bytes, missing qualifications, and omitted checks.
Version drift makes a comparison inconclusive until reconciled. A repaired record
must not remain labeled stale solely because its ID is unchanged. Record the scoped
result in the existing outcome case; exact questions and rankings stay external.

## Verify consumption in a host

Use fresh isolated sessions and a declared small task/time budget. Discover native
CLI flags from the installed host's documentation. Preserve canonical skill content
and provide only the host-specific discovery route needed. Record the host/model
version, guidance hashes, repository revision, corpus versions, exposed tools,
settings that cannot be controlled, and the prompt before starting.

Test a natural request separately from an explicit skill invocation. Include a
nearby task that should not trigger the workflow and a case with insufficient
knowledge. Inspect the transcript for discovery, readable tool results, relevant
retrieval, necessary full-read expansion, and correct application. Grade the actual
answer or patch against predeclared criteria, retaining failures and timeouts.
Connection health alone does not establish model-visible content or compliance.

For improvement claims, compare each host with its own baseline under matched
conditions and repeat trials; keep held-out cases. Separate loading, transport,
retrieval, judgment, and verification failures. Shared guidance does not establish
equal model capability. A smoke test establishes only the behavior it observed;
continue outcome assessment during later comparable authorized tasks.
