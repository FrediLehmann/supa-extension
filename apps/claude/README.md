# Supabase for Claude

Status: **Planned — not implemented yet** · Host: Claude Code

This will bring the local Supabase workflow to Claude Code: detect whether a project's stack is
running, start and stop it with the Supabase CLI, and surface the Studio and Mailpit URLs.

Part of the [supa-extension](../../README.md) monorepo. There is no code in this directory yet; it
contains only this README.

## Planned behavior

The same behavior as the [OpenCode extension](../opencode/README.md), adapted to a terminal agent:

- find `supabase/config.toml` in the session directory or the project root;
- report whether the stack is configured and running;
- run `supabase start` and `supabase stop` in the project directory;
- return the Studio and Mailpit URLs from `supabase/config.toml` (defaults `54323` and `54324`).

Claude Code does not expose an OpenCode-style desktop session header, so the workflow will be exposed
through Claude Code's own extension surfaces, such as a command or tool, instead of a GUI badge. The
exact shape is not decided or implemented yet.

## What is reused

Everything Supabase-specific comes from [`packages/supabase`](../../packages/supabase):

- `src/index.ts` — host-agnostic status detection;
- `src/node.ts` — config parsing, container detection, and the `supabase start` / `supabase stop`
  lifecycle.

Nothing from [`apps/opencode`](../opencode) is reused: its `@opencode/plugin`, RPC, and Solid GUI are
OpenCode-specific. This adapter should only add the Claude Code integration layer.

## Requirements

- [Claude Code](https://claude.com/claude-code).
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) —
  `brew install supabase/tap/supabase`.
- Docker running the local Supabase containers.
- Bun for development.

## Implementation notes

Once work starts, follow the structure of the OpenCode extension:

- keep the adapter code in this directory;
- keep shared Supabase behavior in `packages/supabase` rather than copying it;
- document the install and usage steps here, replacing this placeholder.
