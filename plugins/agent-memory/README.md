# Agent Memory plugin

Shared project history and cooperative edit ownership for Codex, Claude Code,
Grok Build, Cursor, and other Agent Skills or Agent Plugins hosts. One skill
teaches focused retrieval, full-record expansion, evidence verification, claims,
and durable knowledge maintenance across repositories.

## Prerequisite

Run [memd](https://github.com/rhymiz/agent-memory#install-on-linux) **0.6.2 or later**
on the machine running the agent. The plugin connects over HTTP to
`http://127.0.0.1:8787/mcp`; it does not start another daemon or own a database.
Check `curl http://127.0.0.1:8787/health` before connecting.
Remote or cloud agents need an endpoint reachable from their own runtime;
their loopback address does not refer to your laptop.

Plugin versions are independent of daemon versions. Updating this plugin updates
guidance and connection configuration. It does not install or restart memd.

## Codex

```sh
codex plugin marketplace add rhymiz/agent-memory
codex plugin add agent-memory@agent-memory
```

Start a new session and select Agent Memory. The repository marketplace is
`.agents/plugins/marketplace.json`. The package includes both a portable
`plugin.json` and the `.codex-plugin/plugin.json` compatibility manifest.
For an exact release, add the marketplace with `--ref plugin-v0.1.0`.

## Claude Code

```sh
claude plugin marketplace add rhymiz/agent-memory
claude plugin install agent-memory@agent-memory
```

The catalog is `.claude-plugin/marketplace.json`. To test a downloaded or cloned
bundle for one session, use `claude --plugin-dir /path/to/agent-memory`.

## Grok Build

```sh
grok plugin install 'rhymiz/agent-memory#plugins/agent-memory'
grok plugin details agent-memory
```

Grok supports the Claude plugin layout. If it already discovers this plugin from
your Claude installation, use that installation instead of adding a second copy.
For a local bundle, pass its directory to `grok plugin install`.

## Cursor

Load a local bundle with the CLI:

```sh
cursor-agent --plugin-dir /path/to/agent-memory
```

Sign in with `cursor-agent login` and approve the plugin's MCP connection and
requested tools. For headless use, configure the needed `Mcp(agent-memory:tool)`
permissions in `.cursor/cli.json`; approving a server alone does not approve
every tool. See [Cursor CLI permissions](https://cursor.com/docs/cli/reference/permissions).

For the IDE, place the plugin directory at
`~/.cursor/plugins/local/agent-memory` and start a new agent session. For example,
from a checkout of this repository, on a first installation:

```sh
mkdir -p ~/.cursor/plugins/local
cp -R plugins/agent-memory ~/.cursor/plugins/local/agent-memory
```

Cursor also supports repository marketplaces through its Customize/team
marketplace UI; use `https://github.com/rhymiz/agent-memory`. The catalog is
`.cursor-plugin/marketplace.json`. Team marketplace availability depends on your
Cursor plan. This repository provides an installable package; it does not imply
listing or approval in Cursor's public marketplace.

## Standalone skills and other agents

Use the portable `plugin.json` and `mcp.json` with hosts that implement
[Agent Plugins](https://agent-plugins.org/). Hosts without plugin support can
install the `shared-agent-memory` directory from `skills/`, or the standalone
skill release archive. Copy the complete directory, including `references/`.

Common user-level skill locations:

| Host                        | Skill directory                        |
| --------------------------- | -------------------------------------- |
| Codex and compatible agents | `~/.agents/skills/shared-agent-memory` |
| Claude Code                 | `~/.claude/skills/shared-agent-memory` |
| Grok Build                  | `~/.grok/skills/shared-agent-memory`   |
| Cursor                      | `~/.cursor/skills/shared-agent-memory` |

Configure an HTTP MCP connection separately at `http://127.0.0.1:8787/mcp` when
using only the skill. Use the same approach for a custom endpoint: configure the
connection in the host, rather than editing an installed plugin cache. A host
must support both skill discovery and MCP to load both parts; arbitrary harnesses
may require their own instruction injection and MCP configuration.

Use one installation route per host to avoid duplicate skills or connections.
Choose the destination supported by the installed client, preserve unrelated
configuration, and refresh or restart its session after installation.

## Using the guidance

Ask the agent to use the shared-agent-memory skill for the current task. For
consistent project use, add a short instruction to the project's normal agent
guidance file:

> Before significant project work, use the shared-agent-memory skill to retrieve
> relevant context and coordinate shared edits. Skip trivial standalone tasks.

The skill derives identity from the current repository unless the project supplies
an explicit ID. Consumer project IDs, credentials, local paths, and evaluation
questions do not belong in this package. A plugin does not grant permission to
edit a project or store knowledge beyond the user's task.

Verify the installation in a fresh session: the agent should identify the bundled
skill, retrieve a focused briefing, expand a relevant full record, and distinguish
historical evidence from current verification. Discovery alone does not establish
correct use. No particular memory needs to exist in a new project.

## Releases and updates

[Plugin releases](https://github.com/rhymiz/agent-memory/releases) use tags such as
`plugin-v0.1.0`, with `agent-memory-plugin-0.1.0.tar.gz`,
`agent-memory-skill-0.1.0.tar.gz`, and `SHA256SUMS`. Verify the checksum and unpack
the plugin archive; its `agent-memory/` directory is the complete plugin.
The skill archive contains `shared-agent-memory/` for standalone installation.
Neither archive requires Bun or Node to load its guidance.

Marketplace installations update through the host's plugin manager; pinned Git
refs remain pinned until changed. Local copies and standalone skills need an
explicit copy/update from the new release. Keep the plugin's manifests at the
same version and test discovery after an update. Plugin releases do not replace
the latest daemon release used by the Linux installer.

## Format references

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Claude plugins](https://code.claude.com/docs/en/plugins)
- [Grok skills and plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces)
- [Cursor plugin reference](https://cursor.com/docs/reference/plugins)
- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Plugins specification](https://agent-plugins.org/)
