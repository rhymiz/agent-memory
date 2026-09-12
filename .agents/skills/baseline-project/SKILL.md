---
name: baseline-project
description: Set up, audit, refresh, or evaluate repository agent guidance. Use for AGENTS.md and coding-skill maintenance, not ordinary feature work.
---

# Maintain an agent baseline

Produce concise guidance grounded in inspected contracts, code, and commands. Use the user's existing engineering preferences and requested scope. Guidance can improve an agent's decisions; it cannot establish equal model capability.

## Choose the operation

Read only the reference needed for the request:

- **Set up or refresh guidance:** use [maintain.md](references/maintain.md) for authoring, evidence review, and verification. Setup creates or improves guidance; refresh reviews changed evidence and updates or affirms affected rules.
- **Audit guidance:** use [audit.md](references/audit.md) to assess existing instructions and recommend changes. Audit alone is read-only and does not execute project checks. An explicit request to apply findings authorizes the corresponding maintenance work.
- **Assess a guidance change:** use [outcomes.md](references/outcomes.md) for evidence from subsequent comparable work. Use [evaluate.md](references/evaluate.md) for controlled trials when requested with an available runner and budget. The CLI does not launch models.
- **Edit an evidence record:** consult [project-record.md](references/project-record.md) for its schema and command contracts.

Infer the operation from the request. Ordinary engineering work does not call for a repository-wide guidance rewrite. Preserve unrelated edits, canonical files, symlinks, and imports. Project setup does not implicitly authorize global installation, changes to other repositories, or publication.

## Shared decisions

Resolve the project directory and applicable instructions. Use normative contracts for intended behavior, code for current behavior, and version-matched official documentation for uncertain APIs. Inventory paths are candidates, not authority. Read relevant sources; avoid secrets and environment-value files.

Keep global preferences separate from project rules. Current implementation facts and temporary task limits do not create permanent prohibitions or approval requirements. Respect the user's existing authorization; identify the exact instruction and its authority if a real conflict blocks dependent work, and continue independent work.

Define completion for the requested operation. For authorized maintenance, finish the affected guidance, evidence review, required checks, and report; do not stop at a first draft for another routine approval. Report blocked work accurately. For completed checks, repeat or broaden testing only when a change, failure, or unresolved concern justifies it.

## CLI access

Use `uvx agent-baseline@0.4.0 <command> <project>` or an installed matching `agent-baseline`. Requires uv and Python 3.11+; Git is optional for inventory and verification runs on macOS/Linux. The CLI has no model API dependency.

Installed guidance and references are persistent files. Read the linked files directly. For hosts without file-based discovery, `skill show --file SKILL.md` retrieves this router and `skill show --file references/audit.md` retrieves a selected reference. `skill show` without a selector exports the complete bundle with file headings.
