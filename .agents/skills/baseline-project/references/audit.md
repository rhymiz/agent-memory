# Audit agent instructions

Assess whether instructions help the requested work and preserve its authority and scope. Audit alone reads and reports; it does not edit files, record a baseline, or run project verification commands. If the user also requests fixes, apply supported findings through [maintain.md](maintain.md).

## Inspect the relevant instruction surface

Start with applicable root guidance and the skills or references relevant to the requested audit. Inspect descriptions together when reviewing skill selection; inspect reference bodies when their behavior matters. Include active imports, aliases, and scoped overrides. Name unavailable host or global context as a coverage limit instead of assuming it was inspected. Do not expand a scoped audit into every installed skill.

Trace recommendations to actual instructions and sources. A word count or suspicious phrase can locate a candidate, but does not establish a semantic defect. `doctor` checks structure and links; it cannot decide that a rule is obsolete, redundant, or overly restrictive.

## Decision criteria

Apply these criteria to existing instructions as well as newly authored guidance:

| Criterion | Evidence and decision |
| --- | --- |
| Trigger precision | Identify an applicable request and a nearby request that should not activate the rule or skill. Narrow catchall descriptions and overlapping triggers when their actual workflows differ. Keep the description short enough to communicate its purpose without a capability inventory. |
| Authority and freshness | Compare commands and implementation claims with maintained contracts and current source. Retain explicit policy even when implementation differs; report the contradiction. Temporary task limits and absent dependencies do not establish lasting bans. |
| Engineering decisions | For important engineering rules in scope, trace applicability and the invariant to supporting authority and a check or concrete review criterion, using the [output contract](maintain.md#output-contract). Inspect the relevant assertions before accepting claimed coverage. Flag missing relationships, unsupported coverage claims, and undisclosed gaps; accept concise prose and canonical links without requiring a particular layout. |
| Reading scope | Identify which decision requires each prerequisite document. Move conditional reading behind its task trigger; keep essential shared constraints accessible. |
| Procedure necessity | Retain ordering required by correctness or recovery, such as reviewing evidence before recording it. Replace incidental itineraries with outcomes and decision criteria when multiple approaches are valid. |
| Permission boundaries | Identify the authority for each approval stop and whether existing authorization already covers it. Narrow unsupported or repeated approval gates while preserving explicit user policy and host permissions. |
| Completion and checks | State the observable finish for each workflow. Preserve required checks; remove unconditional repeats or broad testing unrelated to the change. Distinguish a real blocker from routine work still needed to finish. |
| Instruction interaction | Trace conflicting rules, duplicate sources, and host routing. Preserve the canonical source and inspect precedence before proposing consolidation. |
| Consumer setup and outcomes | For an in-scope learning workflow, check that the evidence destination, retrieval/update route, and trigger are usable without asking the consumer to write missing instructions. Trace substantive changes to their original finding, expected improvement, and subsequent evidence using [outcomes.md](outcomes.md). Distinguish an applied change from an assessed improvement; preserve contrary and inconclusive results. |

Do not remove a constraint merely because a newer model seems capable without it. Shared guidance can serve multiple models. Assess observed task outcomes within their stated scope using [outcomes.md](outcomes.md). Broader causal or cross-model claims need controlled trials; use [evaluate.md](evaluate.md) when preparing or conducting that evaluation.

## Findings

For each actionable finding, provide the exact file and instruction, the triggering example, supporting evidence, likely effect, and a proposed disposition: **keep**, **narrow**, **move**, or **remove**. Supply replacement wording when helpful. Distinguish observed failures from predicted effects and unresolved authority questions. Do not fabricate findings to fill a quota or list every sound instruction.

Finish with prioritized recommendations, inspected scope, and unresolved questions. Name the sources, records, revisions, and assertions actually checked, and distinguish requested scope from missing, unavailable, or truncated evidence. A search returning no matches does not establish a complete review. Audit alone does not initialize outcome storage or create follow-ups. If an instruction requires pausing, cite the exact rule and explain why existing authorization does not resolve it. Preparation for a later approval should reach a concrete, reviewable result within the already-authorized scope.
