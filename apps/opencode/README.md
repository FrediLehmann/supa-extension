# Supabase for OpenCode

Status: **Available** · Package: `opencode-supabase-extension` · Host: OpenCode (TUI and Desktop)

An OpenCode extension that brings a local Supabase stack into your session. It reports whether the
project's stack is running, starts and stops it with the Supabase CLI, and opens Supabase Studio and
Mailpit from the session header.

Part of the [supabase-agent-extension](../../README.md) monorepo.

## What it adds

It is a single OpenCode plugin with a server part, a TUI part, and a GUI part that share a typed RPC
contract.

| Part         | Entry point                                 | Runs in          | What it adds                                                            |
| ------------ | ------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| Server       | `src/index.ts` → `dist/index.js`            | OpenCode server  | Registers the `supabase` RPC namespace (`status`, `start`, `stop`)      |
| RPC contract | `src/rpc.ts`                                | Shared           | Typed method/input/output definitions used by both parts                |
| TUI          | `src/tui.tsx` → `dist/tui.js`               | OpenCode TUI     | Online indicator and Start/Stop commands                                |
| GUI          | `src/gui.tsx` → `dist/gui-experimental.cjs` | OpenCode Desktop | Session header badge, Start/Stop commands, Studio and Mailpit shortcuts |

### TUI indicator and commands

In the OpenCode TUI, the extension appends a compact `● Supabase` indicator to the footer status bar.
It is green while the current location's stack is running and muted with a hollow circle when stopped.
It polls every 10 seconds and follows the open session's location up to the project root, or the TUI's
location on the home screen. It stays hidden when no `supabase/config.toml` is found. The indicator uses
the same `status` RPC as the desktop badge, and is shown in the home footer on the home screen and in
the prompt footer inside a session. It refreshes right after a start or stop instead of waiting for the
next poll.

The TUI also exposes the same lifecycle as the desktop app:

| Command        | Slash command     | What it does                                |
| -------------- | ----------------- | ------------------------------------------- |
| Start Supabase | `/supabase-start` | Runs `supabase start` and toasts the result |
| Stop Supabase  | `/supabase-stop`  | Runs `supabase stop` and toasts the result  |

Both are available from the command palette under the **Supabase** group and act on the open session's
project, or the TUI's location on the home screen. Only one start or stop runs at a time.

### Status badge

The badge appears in the session header when the session belongs to a project with a
`supabase/config.toml`. It:

- polls every 10 seconds, and only while the session is visible;
- greys out when the stack is stopped;
- shows a spinner while a start or stop is in progress;
- is disabled when the stack is not running.

### Studio and Mailpit

Clicking the badge while the stack is running opens Supabase Studio and Mailpit in the desktop browser
pane. Studio refuses to be framed (`X-Frame-Options: DENY`), so it cannot live in an embedded iframe.

### Commands

| Command        | Slash command     | What it does                                |
| -------------- | ----------------- | ------------------------------------------- |
| Start Supabase | `/supabase-start` | Runs `supabase start` and toasts the result |
| Stop Supabase  | `/supabase-stop`  | Runs `supabase stop` and toasts the result  |

Both commands act on the current session's project. Start can pull images on the first run, and stop
backs up the database, so the CLI calls get a 10-minute timeout.

### Project discovery

The extension looks for `supabase/config.toml` in the session directory first, then in the project's
worktree root, so a session opened in a subdirectory still finds the project. If no config is found,
the badge and TUI indicator stay hidden and the commands report that no project was found.

### Ports

Studio defaults to `54323` (`studio.port`) and Mailpit to `54324` (`local_smtp.port`, falling back to
`inbucket.port`). Both are read from `supabase/config.toml`.

## How it works

The server part uses [`@supabase-agent-extension/supabase`](../../packages/supabase/src/node.ts) to do the work:

- read and parse `<project>/supabase/config.toml`;
- detect running containers with `docker ps --filter label=com.supabase.cli.project=<project_id>`;
- run `supabase start` / `supabase stop` in the project directory.

The TUI and GUI call the RPC methods `status`, `start`, and `stop`. The CLI lookup also checks Homebrew and
`~/.local/bin`, so it still works when OpenCode Desktop is started from the dock or Finder with a
minimal `PATH`. If the CLI is missing, the extension reports how to install it.

## Requirements

- [OpenCode Desktop](https://opencode.ai) with a V2 plugin API (`@opencode/plugin` 2.x) for the badge
  and commands, or the OpenCode TUI for the footer indicator and commands.
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) —
  `brew install supabase/tap/supabase`.
- Docker running the local Supabase containers.
- [Bun](https://bun.sh) to install dependencies and build the plugin.

## Install

The extension is loaded from a local path. Build it first, from the repository root:

```sh
bun install
bun run build:opencode
```

Then add this directory to the `plugins` array in your global
`~/.config/opencode/opencode.json(c)`. OpenCode Desktop only loads GUI parts from the global config,
so use it rather than a project config:

```jsonc
{
	"$schema": "https://opencode.ai/config.json",
	"plugins": ["/absolute/path/to/supabase-agent-extension/apps/opencode"]
}
```

A single entry loads every part. Open a session inside a project that has a `supabase/config.toml` and
the Supabase badge appears in the session header; the TUI part adds the same indicator to the prompt
footer when you run OpenCode in the terminal.

## Development

```sh
bun install     # repository root: installs every workspace
cd apps/opencode
bun run dev     # rebuild every part on change
bun run build   # one-off production build
```

The package `exports` point at `dist/`, which is gitignored, so it must be built for OpenCode to load
the plugin; rebuild after changing the plugin or `packages/supabase`. `build:server` bundles the server
part into `dist/index.js` with `bun build`, `build.tui.ts` bundles the TUI part into `dist/tui.js`,
compiling its JSX with OpenTUI's Solid transform, and Vite builds the GUI part into
`dist/gui-experimental.cjs`. Each output inlines
`packages/supabase` and keeps `@opencode/plugin`, Solid, and OpenTUI external, since OpenCode provides
them.

The helpers in `src/shared.ts` are covered by `src/shared.test.ts`, the TUI plugin's slot and command
wiring by `src/tui.test.ts`, and the GUI wiring by `src/gui.test.ts`. The GUI test loads `gui.tsx`
through Vite and `vite-plugin-solid` because Bun cannot compile Solid JSX. Run the suite from the
repository root with `bun run test`.

### Layout

```
src/
  index.ts    server part: registers the RPC methods
  rpc.ts      RPC contract shared by the server, TUI, and GUI
  shared.ts   helpers the TUI and GUI share: the pending map and the badge tooltip
  status.ts   status polling shared by the TUI indicator and the GUI badge
  tui.tsx     TUI part: footer indicator and Start/Stop commands
  gui.tsx     GUI part: badge, commands, Studio and Mailpit shortcuts
build.tui.ts    builds the TUI part into dist/ with OpenTUI's Solid transform
vite.config.ts  builds the GUI bundle with the Solid plugin
```

## Troubleshooting

- **No badge** — the session's project has no `supabase/config.toml`, or the plugin is not listed in
  the global OpenCode config.
- **No TUI indicator** — the session's project has no `supabase/config.toml`, or the TUI has not
  loaded the `./tui` part. Confirm the package `exports` include `./tui` and that the plugin is listed
  in the OpenCode config.
- **TUI part missing after adding `./tui`** — the background server resolves every plugin's
  entrypoints once at startup and caches them, so a TUI launched against an already-running server
  cannot see a newly added `./tui` export. Make sure `dist/tui.js` was built. Restart the server (`opencode service restart`) or restart
  OpenCode, then reopen the TUI. `opencode --standalone` starts a fresh server and is a quick way to
  confirm the TUI part itself works.
- **Badge is greyed out** — the stack is not running; use **Start Supabase** or `supabase start`.
- **CLI not found** — install it with `brew install supabase/tap/supabase`.
- **Docker errors** — make sure Docker is running; the CLI needs it for every service.
