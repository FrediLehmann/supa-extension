# Supabase for pi

Status: **Available** · Package: `pi-supabase-extension` · Host: [pi](https://pi.dev)

An extension that brings the local Supabase stack into a pi session. It reports whether the project's
stack is running, starts and stops it with the Supabase CLI, and opens Supabase Studio and Mailpit.

Part of the [supabase-agent-extension](../../README.md) monorepo.

## What it adds

pi has no OpenCode-style session badge, so the same workflow is exposed through pi's own surfaces: a
tool the model can call, slash commands for the human, and an indicator in the footer.

| Surface          | Name                      | What it does                                                          |
| ---------------- | ------------------------- | --------------------------------------------------------------------- |
| Tool             | `supabase`                | `status`, `start`, `stop`, and `open` for the local stack             |
| Command          | `/supabase-start`         | Runs `supabase start` and notifies the result                         |
| Command          | `/supabase-stop`          | Runs `supabase stop` and notifies the result                          |
| Command          | `/supabase-open`          | Opens Studio and Mailpit in the browser while the stack runs          |
| Footer indicator | Status text in the footer | Green while running, muted and hollow while stopped, hidden otherwise |

The indicator reads `● Supabase` while the stack runs and `○ Supabase` while it is stopped.

The model is told to use the `supabase` tool when the user asks about the stack or wants it started or
stopped. The tool and the commands share the same work and the same in-flight guard: while a start or
a stop runs, another request reports that Supabase is already changing state.

### Footer indicator

On `session_start` the extension reads the status and appends the indicator to the footer, then polls
every 10 seconds. It refreshes right after a start, a stop, or a status read instead of waiting for the
next poll. It stays hidden when no `supabase/config.toml` is found. Headless runs (`-p` and JSON
modes) do not poll at all. Polling stops on `session_shutdown`.

### Project discovery

The extension looks for `supabase/config.toml` in the session's working directory and then in its
parents up to the git root, so a session opened in a subdirectory still finds the project. The walk
never goes above the home directory, so a stray `~/supabase` is not mistaken for the project of every
session started outside a repository. If no config is found, the indicator stays hidden and the
commands report that no project was found.

### Ports

Studio defaults to `54323` (`studio.port`) and Mailpit to `54324` (`local_smtp.port`, falling back to
`inbucket.port`). Both are read from `supabase/config.toml`.

## How it works

Everything Supabase-specific comes from [`packages/supabase`](../../packages/supabase):

- `src/index.ts` — host-agnostic status detection;
- `src/host.ts` — the helpers every host adapter shares: polling interval, the offline status, the
  lifecycle wrappers, the tool schema and its actions behind one in-flight guard, the Start/Stop
  commands, the status report, and the URLs a host opens;
- `src/node.ts` — config loading, project discovery, opening the browser, container detection with
  `docker ps --filter label=com.supabase.cli.project=<project_id>`, and the `supabase start` /
  `supabase stop` lifecycle in the project directory.

Start can pull images on the first run, and stop backs up the database, so both CLI calls get a
10-minute timeout. The CLI lookup also checks Homebrew and `~/.local/bin`, so it still works when pi is
started from a launcher with a minimal `PATH`. If the CLI is missing, the extension reports how to
install it.

`src/node.ts` reads `supabase/config.toml` with the small TOML reader in
[`packages/supabase/src/toml.ts`](../../packages/supabase/src/toml.ts). Bun's TOML parser only exists in
Bun, and pi runs on Node, so the reader keeps one code path in both hosts.

Nothing from [`apps/opencode`](../opencode) is reused: its `@opencode/plugin`, RPC contract, and Solid
GUI are OpenCode-specific.

### Layout

```text
src/
  index.ts    the extension: tool, commands, footer indicator, polling
  shared.ts   the footer indicator text and its key
```

## Requirements

- pi with extension support.
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) —
  `brew install supabase/tap/supabase`.
- Docker running the local Supabase containers.

The extension has no runtime dependencies: the shared package is bundled into `dist/index.js`, and the
host package is only imported for types.

## Install

Build it first, from the repository root:

```sh
bun install
bun run build:pi
```

Then add this directory to the `extensions` array in your global `~/.pi/agent/settings.json`:

```json
{
	"extensions": ["/absolute/path/to/supabase-agent-extension/apps/pi"]
}
```

Or load it for one run with `pi -e /absolute/path/to/supabase-agent-extension/apps/pi`.

The directory's `package.json` points `pi.extensions` at `dist/index.js`, which is gitignored, so rebuild
after changing the extension or the shared package. Open a
session inside a project with a `supabase/config.toml` and the footer shows the Supabase indicator;
`/supabase-open` opens Studio and Mailpit, and the model can read the status or start and stop the
stack through the `supabase` tool.

## Development

```sh
bun run build         # rebuild dist/index.js
bun run test          # repository root: status, TOML, and extension wiring tests
bun run lint
bun run format:check
```

The shared helpers are covered by `src/shared.test.ts`, and the tool, commands, indicator, and
in-flight guard by `src/index.test.ts`, which swaps the Supabase actions for fakes through the `Host`
seam.

## Troubleshooting

- **No footer indicator** — the session's project has no `supabase/config.toml`, or the extension is
  not listed in `~/.pi/agent/settings.json`.
- **The indicator is greyed out** — the stack is not running; use `/supabase-start` or
  `supabase start`.
- **CLI not found** — install it with `brew install supabase/tap/supabase`.
- **Docker errors** — make sure Docker is running; the CLI needs it for every service.
