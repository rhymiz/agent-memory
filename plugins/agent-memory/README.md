# Agent Memory plugin

Shared project history and cooperative edit ownership for Codex, Claude Code,
Grok Build, Cursor, and other Agent Skills or Agent Plugins hosts. One skill
teaches focused retrieval, full-record expansion, evidence verification, claims,
and durable knowledge maintenance across repositories.

## Prerequisite

Run [memd](https://github.com/rhymiz/agent-memory#install-on-linux) **0.6.3 or later**
on the machine running the agent. The plugin connects over HTTP to
`http://127.0.0.1:8787/mcp`; it does not start another daemon or own a database.
Check `curl http://127.0.0.1:8787/health` before connecting.
Remote or cloud agents need an endpoint reachable from their own runtime;
their loopback address does not refer to your laptop. For the
[hosted service](https://github.com/rhymiz/agent-memory#hosted-service-on-cloudflare),
configure the host's MCP connection with its `https` endpoint and an
`Authorization: Bearer` header supplied from the environment instead of this
plugin's loopback configuration.

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
For an exact release, add the marketplace with `--ref plugin-v0.1.2`.

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
Local installations follow the source directory through a symlink; update that
source to update the installed plugin. Before changing installation routes, inspect
`grok plugin list --json` and `grok plugin details agent-memory` for the selected
source. Different sources with the same plugin name can coexist while discovery
shows only one; uninstalling it can reveal the other. After removing an obsolete
source, inspect again before installing a replacement. Preserve the installation
you intend to use and verify its manifest version in a fresh session.

## Cursor

Load a local bundle with the CLI:

```sh
cursor-agent --plugin-dir /path/to/agent-memory
```

Sign in with `cursor-agent login` and approve the plugin's MCP connection and
requested tools. Cursor names this plugin's server
`plugin-agent-memory-agent-memory`. Headless tool permissions must use that name,
not the standalone MCP configuration key `agent-memory`. For retrieval and batch
coordination, merge these entries into `.cursor/cli.json`:

```json
{
  "permissions": {
    "allow": [
      "Mcp(plugin-agent-memory-agent-memory:project_briefing)",
      "Mcp(plugin-agent-memory-agent-memory:memory_get)",
      "Mcp(plugin-agent-memory-agent-memory:claims_acquire)",
      "Mcp(plugin-agent-memory-agent-memory:claims_renew)",
      "Mcp(plugin-agent-memory-agent-memory:claims_release)"
    ]
  }
}
```

Include other named tools needed by your workflow, such as `project_context_get`
or `memory_update`, using the same prefix. A separately configured standalone
server named `agent-memory` uses `Mcp(agent-memory:tool)` instead. The
`--approve-mcps` flag approves connections; it does not grant every tool permission.
See [Cursor CLI permissions](https://cursor.com/docs/cli/reference/permissions).

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
Check both the selected skill path and MCP source. User-level, repository-level,
plugin, and compatibility discovery can expose different copies of the same name.

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
`plugin-v0.1.2`, with `agent-memory-plugin-0.1.2.tar.gz`,
`agent-memory-skill-0.1.2.tar.gz`, and `SHA256SUMS`. Verify the checksum and unpack
the plugin archive; its `agent-memory/` directory is the complete plugin.
The skill archive contains `shared-agent-memory/` for standalone installation.
Neither archive requires Bun or Node to load its guidance.

Marketplace installations update through the host's plugin manager; pinned Git
refs remain pinned until changed. Local copies and standalone skills need an
explicit update from the new release. Unpack into a new directory, verify it, then
replace the selected old bundle; copying over it can leave removed files behind.
For symlink-based installations, update the source directory the link targets.
Keep the plugin's manifests at the
same version and test discovery after an update. Plugin releases do not replace
the latest daemon release used by the Linux installer.

For release verification, start a fresh headless session with the documented
permissions. Have the agent identify its skill file and selected plugin version,
retrieve a focused briefing, and expand a relevant full record when one exists.
Exercise claim acquisition and release in an isolated project, including an invalid
resource that should produce a readable error before correction. Inspect actual
tool results and remaining claims. Missing knowledge and client/provider failures
must remain visible in the verification result.

## Format references

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Claude plugins](https://code.claude.com/docs/en/plugins)
- [Grok skills and plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces)
- [Cursor plugin reference](https://cursor.com/docs/reference/plugins)
- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Plugins specification](https://agent-plugins.org/)
