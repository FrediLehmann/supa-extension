# supa-extension

Supabase extensions for AI coding agents.

This repository is a Bun monorepo that houses Supabase integrations for agentic coding tools. It
uses one shared Supabase core and thin host adapters, so project detection, status reporting, and
start/stop behave the same everywhere.

## Extensions

| Extension             | Host                       | Status    | Docs                                                 |
| --------------------- | -------------------------- | --------- | ---------------------------------------------------- |
| Supabase for OpenCode | OpenCode (TUI and Desktop) | Available | [`apps/opencode/README.md`](apps/opencode/README.md) |
| Supabase for Claude   | Claude Code                | Planned   | [`apps/claude/README.md`](apps/claude/README.md)     |
| Supabase for pi       | pi                         | Available | [`apps/pi/README.md`](apps/pi/README.md)             |

Each extension is a host adapter: it exposes the same Supabase workflow through the tooling that host
provides. The OpenCode and pi adapters are implemented today.

## Shared core

[`packages/supabase`](packages/supabase) contains the Supabase logic with no dependency on any agent:

- `src/index.ts` — environment-agnostic status detection. Given a config reader and a container
  checker, it reports whether a project is configured, whether its stack is running, and where Studio
  and Mailpit are served.
- `src/node.ts` — the Node/Bun implementation. It reads `supabase/config.toml` with the portable TOML
  reader in `src/toml.ts`, checks for running containers with
  `docker ps --filter label=com.supabase.cli.project=<project_id>`, and runs `supabase start` /
  `supabase stop`.
- `src/toml.ts` — the subset of TOML the status needs, since Bun's parser is unavailable when an
  extension runs on Node. A malformed config is reported as no project.
- `src/host.ts` — the helpers every adapter shares: polling interval, the offline status, the
  lifecycle wrappers, and the URLs a host opens.

Shared behavior belongs there; host-specific UI, commands, and packaging belong in each `apps/`
directory.

## Repository layout

```text
apps/
  opencode/          Supabase extension for OpenCode (available)
  claude/            Supabase extension for Claude Code (planned)
  pi/                Supabase extension for pi (available)
packages/
  supabase/          host-agnostic Supabase status and lifecycle logic
  assets/            icons and other static assets
supabase/            local Supabase project used to develop the extensions
```

The `claude` directory currently contains only its README.

## Development

```sh
# repository root: Prettier, ESLint, and Bun test
bun install
bun run format        # Prettier: write
bun run format:check  # Prettier: check only
bun run lint          # ESLint: check only
bun run lint:fix      # ESLint: write fixes
bun run test          # Bun test: run the suite
bun run test:watch    # Bun test: rerun on change
bun run test:coverage # Bun test: text summary and coverage/lcov.info
```

ESLint uses the flat config in [`eslint.config.mjs`](eslint.config.mjs): TypeScript rules from
`typescript-eslint`, Solid rules for `.tsx` files, and `eslint-config-prettier` so lint and format stay
out of each other's way.

Tests use Bun's built-in runner and sit next to the code they cover (`*.test.ts`). They cover the
host-agnostic status logic, TOML reader, and host helpers in
[`packages/supabase`](packages/supabase), the pi helpers and extension wiring in
[`apps/pi/src`](apps/pi/src), the TUI/GUI helpers in
[`apps/opencode/src/shared.ts`](apps/opencode/src/shared.ts), and the slot and command wiring of both
OpenCode plugins. [`gui.test.ts`](apps/opencode/src/gui.test.ts) loads `gui.tsx` through Vite and
`vite-plugin-solid`, since Bun's runner cannot compile Solid JSX on its own. `bun run test:coverage`
prints a text summary and writes `coverage/lcov.info` for editors or CI; Bun only reports modules the
suite loads directly, so the Vite-loaded GUI file is not in that number.

Building and running an extension is documented in its own README: start with
[`apps/opencode/README.md`](apps/opencode/README.md) for OpenCode and
[`apps/pi/README.md`](apps/pi/README.md) for pi.

## Requirements

All extensions need the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
(`brew install supabase/tap/supabase`) and Docker, since the CLI runs the local stack in containers.
Host-specific requirements are listed in each extension's README.

## License

MIT — see [LICENSE](LICENSE).
