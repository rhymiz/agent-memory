# Evaluate guidance across models

For a follow-up on work that has already occurred, use [outcomes.md](outcomes.md): assess the original criterion against the actual artifacts, record comparison limits and coverage, and retain unchanged, regressed, or inconclusive results. This needs no extra model run. A passing check or a completed change is not an improvement grade.

## Controlled trials

The controlled procedure below needs an agent runner and a declared execution budget. The included CLI does not launch models or synthesize benchmark scores.

Choose historical tasks with observable acceptance criteria: an invented nullable state, unsafe boundary parsing, stale async responses, wrong test setup, or premature completion. Include nearby tasks that should not activate a specialized skill. Keep some cases held out.

For each case, record its base commit, task prompt, fixtures, setup, acceptance criteria, independent grader, and runtime prerequisites. Write requirements visible to the implementing agent; do not hide new requirements in the grader. Keep solution patches and holdout grading implementation outside the implementing agent's accessible workspace.

Compare the current configuration with proposed guidance using the same model/host versions, tools, environment, budget, and initial state. Repeat in fresh workspaces and conversations. Record reasoning settings and global instructions rather than assuming equally named settings behave identically.

Measure two skill conditions separately:

1. Natural request: did the right skill load, and did unrelated requests avoid it?
2. Explicitly supplied skill: did the workflow produce acceptable changes?

Track first-attempt success, success within a declared repair budget, consistency across trials, invariant violations, false completion claims, cost, time, and human intervention. Evaluate the actual artifacts with independent tests and a calibrated architecture rubric. An agent's self-assessment is not a score.

For setup and refresh trials, grade the maintained guidance against the [output contract](maintain.md#output-contract). Trace the important in-scope decisions from application and invariant to authority and actual check coverage or a concrete review criterion. Inspect assertions and canonical links; do not award semantic credit for headings, field presence, a source list, or a passing suite alone. Include cases with an uncovered invariant or a review-only decision, and require the output to disclose that boundary. Acknowledging a gap passes the reporting criterion, not the missing engineering check. Keep per-criterion evidence in the result record below.

Also grade whether setup completed the consumer's learning route: a real destination, usable retrieval/update instructions, and a procedure that can be followed without writing missing policy. Exercise a project with no shared service, a project with an existing evidence store, and unavailable or partial evidence. Require a pending case only when the fixture contains a real finding. For subsequent-outcome cases, include an applied change with no later task, contrary evidence, and a bounded empty search. Grade the actual evidence linkage and honest assessment, not matching labels or template field presence.

Classify failures as loading, missing knowledge, judgment, tooling, verification, or stopping. Fix the responsible layer. Do not keep adding universal instructions for unrelated incidents. Report per-model and per-task-family outcomes with uncertainty; a few successful trials do not prove equivalence.

## Run a reproducible trial

1. Create an isolated checkout at the case's base commit, for example `git worktree add --detach /absolute/path/to/trial BASE_COMMIT`. Keep each trial directory unique. Supply only its intended fixtures and guidance condition; exclude credentials and environment-value files. A worktree isolates edits, not filesystem access or processes: configure the runner's sandbox and tools separately.
2. Save the task prompt and acceptance criteria before invoking the runner. Record the actual guidance file hashes, host/model versions, tools, global settings, elapsed-time/token/cost limits, and allowed repairs. Keep control and treatment identical except for the guidance change. If a host setting cannot be controlled, name that confound.
3. Start a fresh session in the trial checkout using the user's selected runner. An executable wrapper should accept the prompt on stdin, operate in its supplied working directory, write its event transcript to stdout, and return a nonzero status when execution fails. Native CLI flags differ; consult the installed runner's `--help`. Do not silently switch models, increase a failed trial's budget, or retry in an existing conversation.
4. Preserve the transcript, final answer, changed files, exit status, elapsed time, and reported usage. Inspect tool events to establish skill loading. A tool launch alone does not prove the skill was followed. Budget exhaustion, timeouts, and denied tools are outcomes, not missing rows to discard.
5. Run the independent grader against the produced artifact. Run the same grader against the initial defective state first; it must fail for the intended reason. Keep graders and reference solutions outside the writable trial directory, and check that tests were not weakened. Describe every manual rubric decision with an artifact or transcript reference.
6. Save one result per trial using the record below. Repeat each condition, include negative-trigger tasks, and report individual results and denominators before averages. Retain local raw evidence; publish only reviewed, nonprivate summaries.

## Result record

Use this JSON shape as a reporting template, replacing every illustrative value with observed data. It is an evaluation artifact, not input to `agent-baseline verify`.

```json
{
  "case": "boundary-validation",
  "trial": 1,
  "condition": "proposed-guidance",
  "invocation": "natural",
  "base_commit": "exact commit",
  "guidance_sha256": {"AGENTS.md": "actual digest"},
  "runner": {"host": "name and version", "model": "reported model", "settings_file": "settings.json"},
  "budget": {"elapsed_seconds": 300, "repairs": 0},
  "execution": {"status": "completed", "exit_code": 0, "elapsed_seconds": 52, "reported_cost_usd": null},
  "discovery": {"expected_skill": "team-engineering", "loaded": true, "evidence": "events.jsonl:12"},
  "criteria": [
    {"id": "invalid-input-rejected", "passed": true, "evidence": "grader.txt:8"},
    {"id": "existing-behavior-preserved", "passed": true, "evidence": "grader.txt:11"}
  ],
  "false_completion_claim": false,
  "human_interventions": [],
  "artifacts": {"transcript": "events.jsonl", "patch": "change.diff", "grader": "grader.txt"},
  "limitations": ["One trial; no causal improvement or model-parity claim"]
}
```

Use `null` for unavailable measurements and unresolved rubric results. Distinguish `completed`, `failed`, `timed_out`, `budget_exhausted`, and `blocked` execution from criterion pass/fail. A completed run can fail every criterion. For a negative-trigger case, `expected_skill` can be null and the criterion is that the unrelated skill was not invoked. Make a first-attempt success claim only when every required criterion passes, no forbidden side effect occurred, and the final answer accurately describes validation.

A useful starter suite has a guidance-refresh case, an actual engineering regression with an independent test, a task that needs a scoped domain reference, and an unrelated task that should not invoke baseline-project. Expand using failures from the user's codebase, not increasingly long universal prompts. Test a guidance change on held-out cases before adopting it across projects.

## Evaluate instruction scope and completion

For changes to skill routing, approval language, or completion criteria, include:

- A bounded local fix whose request already authorizes implementation and verification. Grade the finished behavior and actual checks; distinguish premature handoff from a genuine blocker.
- A one-word documentation correction that should avoid baseline setup, unrelated skill bodies, and broad tests. Reading applicable instructions and checking the diff remain appropriate.
- A domain task with competing skill descriptions. Preserve the catalog actually exposed by the host, including any truncation; distinguish metadata exposure from body loading. Test both relevant and nearby negative requests.
- A read-only audit with obsolete or overly broad instructions alongside an explicit owner policy that must survive. Grade findings against source authority rather than rewarding deletion or shorter text by itself.

Before each trial, state what completion and justified verification mean for that case. In the existing criteria and intervention records, cite unnecessary approval stops, unfinished authorized work, unrelated reads, and redundant checks. Review a check's preceding changes, failures, and unresolved concerns before calling it redundant. Record tooling denials separately from model stopping behavior. Do not impose universal reading or tool-call quotas.

Evaluate revised guidance within each supported model and host under paired conditions. Guidance helpful to one model may constrain another. Reduced loaded text is an observation, not proof of improved task performance. Keep behavioral evaluation separate from structural CLI tests and evidence freshness.
