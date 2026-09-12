# Project evidence record

Create `.agent-baseline.json` after inspecting the repository's actual guidance, sources, and verification commands. Commit the reviewed record and `.agent-baseline.lock.json` with the guidance. The CLI does not infer authority from a filename.

## Version 2

```json
{
  "schema_version": 2,
  "artifacts": [
    {
      "path": "AGENTS.md",
      "sources": [
        {"path": "package.json", "json_pointer": "/scripts"},
        {"path": "docs/architecture.md", "heading": "Ownership"},
        "tests/domain.test.ts"
      ]
    }
  ],
  "checks": [
    {
      "name": "project-checks",
      "argv": ["npm", "test"],
      "cwd": ".",
      "timeout_seconds": 600
    }
  ]
}
```

This is an illustrative shape, not a template of commands or sources to copy blindly. Select the project's actual files and commands. Python, Rust, Java, shell, documentation-only, and other projects use the same record; no language runtime is assumed by the CLI.

Each artifact is a maintained file with at least one supporting source. All paths are project-relative. Artifacts cannot serve as their own evidence, including through aliases. Outside-project symlinks, absolute paths, `..` segments, duplicates, unknown fields, and malformed values are rejected.

Source forms:

- A string tracks the entire file, appropriate for executable code or compact normative contracts.
- `path` plus `json_pointer` tracks one JSON value using RFC 6901. Use `/scripts/test` for a single command, `/scripts` for the command contract, or an empty pointer for the whole JSON value. Object key order and JSON formatting do not cause drift. Use `~1` for a literal slash and `~0` for a tilde in a key. Missing selections and duplicate JSON keys are errors.
- `path` plus `heading` tracks exactly one named Markdown section, including its subheadings until the next heading of equal or higher level. The exact visible heading must occur once; missing or ambiguous headings are errors. Code-block and YAML-frontmatter headings do not count. Track the whole file if a narrower section would omit relevant authority.

Use selectors to remove irrelevant drift, never to exclude evidence that might contradict the instruction. The configured source set is deliberately bounded; it does not attest the entire codebase.

An empty `artifacts` array is an unconfigured draft emitted by `init`. `record`, `check`, and `verify` cannot certify it. An empty `checks` array is allowed when no project commands are appropriate: `verify` still checks Markdown guidance and reports zero project checks explicitly. With neither Markdown artifacts nor project checks, verification fails because no verification applies; `check` can still report freshness. Never insert a passing no-op to make a project appear tested.

The CLI continues to read version 1 records and locks. Version 1 uses whole-file sources and requires nonempty artifact and check arrays. Upgrade to version 2 deliberately, review the source selections, then record a new snapshot. Older CLI releases cannot read version 2 records.

## Commands and interpretation

Use `uvx agent-baseline@0.4.0`, or the matching installed command:

- `init <project> [--agent codex --agent claude]` installs persistent guidance, prepares selected discovery aliases, and creates an empty record only if no record exists. It preserves existing instructions and records; it does not mark anything reviewed.
- `inspect <project>` lists candidate paths. Git is optional; the filesystem fallback excludes common generated directories and does not interpret ignore files.
- `doctor <project> [--agent codex --agent claude]` checks configured Markdown artifacts and their linked guidance. Without a configured artifact list it checks discovered instructions. Host flags additionally inspect installed entries in the native project skill directories even when artifacts do not link them. Use repeated `--path` arguments to restrict inspection to selected entrypoints and their links. Selected hosts require canonical skill discovery routes within that scope; Claude also requires root routing when `AGENTS.md` exists. No project commands execute.
- `record <project>` validates and stores the reviewed evidence hashes. Run it only after semantic review. It does not certify successful verification.
- `check <project>` compares the hashes and reports changed evidence, affected guidance, and deleted source paths. No project commands execute.
- `verify <project>` rejects stale evidence, runs built-in structural guidance checks, executes every declared project check, and verifies that monitored inputs stayed unchanged.
- `skill show` exports the root skill and all references as Markdown with file headings. `skill show --file SKILL.md` or `--file references/audit.md` exports just that bundled file. The selector accepts an exact bundle path; it never reads arbitrary filesystem paths. An unknown selector is invalid input.

On drift, review the listed artifacts against the changed source selection. An unchanged hash means the selected input is unchanged; a changed hash means review is needed, not necessarily rewriting. Do not automatically run `record` before CI validation or after a failed check.

## Execution boundary

Checks use an argv array and a working directory, never a shell string. The tool does not reinterpret metacharacters, but the declared executable can itself run arbitrary code. Inspect commands and prerequisites before running `verify`. Do not add deployment, production mutation, publishing, secrets, or credential-bearing commands as verification checks.

Check commands inherit the caller's environment, so choose the project's runtime explicitly when needed, such as `uv run pytest`. Timeouts are 1–86400 seconds and kill the process group on macOS/Linux. Background services belong to the normal project harness; the baseline does not start or detach them. The report retains the final 8 KB of combined output per command and may contain project output: review before sharing.

Exit status is 0 for operation success, 1 for drift or failed structural/project verification, and 2 for invalid input, unconfigured evidence, or prerequisites. Missing, malformed, or ambiguous selected evidence cannot produce a passing snapshot. Failed commands, missing executables, and timeouts have separate statuses. JSON reports state verification scope; `skill show` emits Markdown and `--help`/`--version` emit text.

The doctor checks local targets and safe skill YAML, not remote websites, renderer-specific anchor IDs, architecture quality, native browser behavior, or automatic model compliance. Explicit host discovery checks establish file routing; use a fresh native host session to prove that the host loaded the intended skill.
