# Supabase for Claude

Status: **Available** · Plugin: `supabase` · Host: [Claude Code](https://claude.com/claude-code)

A Claude Code plugin that brings the local Supabase stack into a session. It reports whether the
project's stack is running, starts and stops it with the Supabase CLI, and opens Supabase Studio and
Mailpit.

Part of the [supabase-agent-extension](../../README.md) monorepo.

## What it adds

Claude Code has no OpenCode-style session badge, so the same workflow is exposed through Claude Code's
plugin surfaces: an MCP tool the model can call, slash commands for the human, a SessionStart hook,
and an opt-in status line.

| Surface     | Name                | What it does                                                        |
| ----------- | ------------------- | ------------------------------------------------------------------- |
| MCP tool    | `supabase`          | `status`, `start`, `stop`, and `open` for the local stack           |
| Command     | `/supabase:start`   | Runs `supabase start` and reports the result                        |
| Command     | `/supabase:stop`    | Runs `supabase stop` and reports the result                         |
| Command     | `/supabase:open`    | Opens Studio and Mailpit in the browser while the stack runs        |
| Command     | `/supabase:status`  | Reports whether the stack runs, with the Studio and Mailpit URLs    |
| Hook        | `SessionStart`      | Tells the model the stack's state and URLs when a session starts    |
| Status line | `cli.js statusline` | `● Supabase` in green while running, dim `○ Supabase` while stopped |

In the tool list the tool is named `mcp__plugin_supabase_supabase__supabase`. The commands pre-approve
it with `allowed-tools`, so running one does not ask for permission; when the model calls the tool on
its own, Claude Code asks as for any other MCP tool.

The tool and the commands share one MCP server process and one in-flight guard: while a start or a stop
runs, another start, stop, or open reports that Supabase is already changing state. Start and stop can
take minutes; a status read is answered while one runs.

### SessionStart hook

When a session starts, resumes, or is cleared or compacted, the hook reads the status and adds it to the
model's context, so it knows whether the stack runs and where Studio and Mailpit are without calling the
tool first. It adds nothing when the project has no `supabase/config.toml`.

### Status line

Claude Code has one status line command, set in your own settings, so a plugin cannot add to it. To show
the indicator, point `statusLine` in `~/.claude/settings.json` at the plugin's CLI:

```json
{
	"statusLine": {
		"type": "command",
		"command": "node /absolute/path/to/supabase-agent-extension/apps/claude/dist/cli.js statusline"
	}
}
```

Point it at the checkout, not at the installed plugin: Claude Code does not expand `${CLAUDE_PLUGIN_ROOT}`
in your settings, and an installed plugin lives in a cache directory whose path changes with every
update. If you installed from the marketplace and have no checkout, clone the repository and build it
(`bun install && bun run build:claude`) for the status line, or update the path after each plugin
update.

If you already have a status line script, run the command from it and append its output; it prints
nothing outside a Supabase project. Claude Code redraws the status line often, so the result is cached in
`$TMPDIR/claude-supabase` for 10 seconds, the same interval the other adapters poll at. The MCP server
and the hook write the same cache, so a start or stop shows up right away.

### Project discovery

Everything acts on the directory Claude Code was started in (`CLAUDE_PROJECT_DIR`) and its parents up to
the git root, so a session opened in a subdirectory still finds the project. The walk never goes above
the home directory, so a stray `~/supabase` is not mistaken for the project of every session.

### Ports

Studio defaults to `54323` (`studio.port`) and Mailpit to `54324` (`local_smtp.port`, falling back to
`inbucket.port`). Both are read from `supabase/config.toml`.

## How it works

Everything Supabase-specific comes from [`packages/supabase`](../../packages/supabase), bundled into
`dist/cli.js`:

- `src/index.ts` — host-agnostic status detection;
- `src/host.ts` — the helpers every adapter shares: polling interval, the offline status, the lifecycle
  wrappers, the tool schema and its actions behind one in-flight guard, the status report, and the URLs
  a host opens;
- `src/node.ts` — config loading, project discovery, container detection with
  `docker ps --filter label=com.supabase.cli.project=<project_id>`, the `supabase start` /
  `supabase stop` lifecycle, and opening the browser.

`bun run build` bundles `src/cli.ts` and the shared package into a single `dist/cli.js` that the
manifest and the hook run with `node`. The marketplace installs the plugin from its npm package,
`claude-supabase-extension`, which ships `dist/` with the manifest, commands, and hook; `dist/` is not
committed.

The plugin has no runtime dependencies. The MCP server speaks the small part of the protocol a tools-only server needs
(`initialize`, `ping`, `tools/list`, `tools/call`) over stdio, so it needs no SDK.

### Layout

```text
.claude-plugin/plugin.json   manifest and the MCP server definition
commands/                    /supabase:start, :stop, :open, :status
hooks/hooks.json             the SessionStart hook
src/
  cli.ts      entry point: mcp, session-start, statusline
  server.ts   the MCP server and the supabase tool
  shared.ts   status line text, hook context, stdin parsing, the status cache
dist/cli.js   the bundle Claude Code runs, built by `bun run build`
```

`version` in the manifest and in `package.json` must match: bump both before tagging a release
(`claude-v<version>`), which publishes the npm package the marketplace installs. `claude plugin update`
picks up a new version once it is published.

## Requirements

- Claude Code with plugin support.
- Node.js 20 or later on the `PATH`.
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) —
  `brew install supabase/tap/supabase`.
- Docker running the local Supabase containers.

## Install

The repository root is a Claude Code marketplace (`.claude-plugin/marketplace.json`) that lists this
plugin, installed from its npm package. In Claude Code:

```text
/plugin marketplace add FrediLehmann/supabase-agent-extension
/plugin install supabase@supabase-agent-extension
```

To try a local checkout for one run without installing it, build it first:

```sh
bun install
bun run build:claude
claude --plugin-dir /absolute/path/to/supabase-agent-extension/apps/claude
```

Open a session inside a project with a `supabase/config.toml`; the model knows the stack's state from
the start, `/supabase:open` opens Studio and Mailpit, and the model can start and stop the stack through
the `supabase` tool.

## Development

```sh
bun run build         # rebuild dist/cli.js after changing src/ or packages/supabase
bun run test          # repository root: status, TOML, and plugin tests
bun run lint
bun run format:check
claude plugin validate apps/claude
```

`src/server.test.ts` covers the protocol, the tool actions, and the in-flight guard with fake Supabase
actions through the `Host` seam; `src/shared.test.ts` covers the status line text, hook context, and
cache. To exercise the server by hand, after a build:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"supabase","arguments":{"action":"status"}}}' | node apps/claude/dist/cli.js mcp
```

## Troubleshooting

- **The `supabase` tool is missing** — run `/mcp` and check `plugin:supabase:supabase`; a failed
  server usually means `node` is missing from the `PATH` or older than 20.
- **No status line indicator** — `statusLine` is not set in your settings, or the session's project has
  no `supabase/config.toml`.
- **The indicator is dim** — the stack is not running; use `/supabase:start` or `supabase start`.
- **CLI not found** — install it with `brew install supabase/tap/supabase`.
- **Docker errors** — make sure Docker is running; the CLI needs it for every service.
