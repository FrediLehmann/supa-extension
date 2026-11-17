# supabase-agent-extension

Supabase extensions for AI coding agents.

This repository is a Bun workspaces monorepo that houses Supabase integrations for agentic coding tools. It
uses one shared Supabase core and thin host adapters, so project detection, status reporting, and
start/stop behave the same everywhere.

## Extensions

| Extension             | Host                       | Status    | Docs                                                 |
| --------------------- | -------------------------- | --------- | ---------------------------------------------------- |
| Supabase for OpenCode | OpenCode (TUI and Desktop) | Available | [`apps/opencode/README.md`](apps/opencode/README.md) |
| Supabase for Claude   | Claude Code                | Available | [`apps/claude/README.md`](apps/claude/README.md)     |
| Supabase for pi       | pi                         | Available | [`apps/pi/README.md`](apps/pi/README.md)             |

Each extension is a host adapter: it exposes the same Supabase workflow through the tooling that host
provides. All three adapters are implemented.

## Shared core

[`packages/supabase`](packages/supabase) contains the Supabase logic with no dependency on any agent:

- `src/index.ts` — environment-agnostic status detection. Given a config reader and a container
  checker, it reports whether a project is configured, whether its stack is running, and where Studio
  and Mailpit are served.
- `src/node.ts` — the Node/Bun implementation. It reads `supabase/config.toml` with the portable TOML
  reader in `src/toml.ts`, finds the project from a session directory, checks for running containers
  with `docker ps --filter label=com.supabase.cli.project=<project_id>`, runs `supabase start` /
  `supabase stop`, and opens URLs in the desktop browser.
- `src/toml.ts` — the subset of TOML the status needs, since Bun's parser is unavailable when an
  extension runs on Node. A malformed config is reported as no project.
- `src/host.ts` — the helpers every adapter shares: polling interval, the offline status, the
  lifecycle wrappers, the `supabase` tool (its schema, description, and actions behind one in-flight
  guard), the Start/Stop commands, the status report, and the URLs a host opens.

The package is never built or published on its own. Each extension lists it as a
`"@supabase-agent-extension/supabase": "workspace:*"` dev dependency, imports it by name
(`@supabase-agent-extension/supabase`, `/host`, `/node`), and its build bundles it in, so a
published extension does not depend on anything outside its own package.

Shared behavior belongs there; host-specific UI, commands, and packaging belong in each `apps/`
directory.

## Repository layout

```text
apps/
  opencode/          Supabase extension for OpenCode (available)
  claude/            Supabase extension for Claude Code (available)
  pi/                Supabase extension for pi (available)
packages/
  supabase/          host-agnostic Supabase status and lifecycle logic
  assets/            icons and other static assets (@supabase-agent-extension/assets)
supabase/            local Supabase project used to develop the extensions
.claude-plugin/      Claude Code marketplace listing the Claude plugin
.github/workflows/   CI: format, lint, type check, build, and test; publishes to npm on release tags
```

## Development

```sh
# repository root: build, type check, Prettier, ESLint, and Bun test
bun install
bun run build         # build every extension into its dist/
bun run typecheck     # tsc for the shared package and every extension
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
[`apps/pi/src`](apps/pi/src), the Claude MCP server, status line, and cache in
[`apps/claude/src`](apps/claude/src), the TUI/GUI helpers in
[`apps/opencode/src/shared.ts`](apps/opencode/src/shared.ts), and the slot and command wiring of both
OpenCode plugins. [`gui.test.ts`](apps/opencode/src/gui.test.ts) loads `gui.tsx` through Vite and
`vite-plugin-solid`, since Bun's runner cannot compile Solid JSX on its own. `bun run test:coverage`
prints a text summary and writes `coverage/lcov.info` for editors or CI; Bun only reports modules the
suite loads directly, so the Vite-loaded GUI file is not in that number.

## Build

Every extension is bundled with [`bun build`](https://bun.sh/docs/bundler) from the `build` script in
its `package.json`. `bun run build` at the root builds them all, and `bun run build:claude`,
`build:pi`, or `build:opencode` builds one. Each build bundles the extension's sources together with
`packages/supabase` into a gitignored `dist/`, keeps the packages the host provides external, and the
package's `exports`, manifest, or `pi.extensions` point at that output. `npm pack` and `npm publish`
build first through `prepack`, and the published packages ship only `dist/` and their manifests.

| Extension | npm package                   | Output                                                                               |
| --------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| Claude    | `claude-supabase-extension`   | `apps/claude/dist/cli.js`                                                            |
| pi        | `pi-supabase-extension`       | `apps/pi/dist/index.js`                                                              |
| OpenCode  | `opencode-supabase-extension` | `apps/opencode/dist/index.js`, `dist/tui.js`, and `dist/gui-experimental.cjs` (Vite) |

The OpenCode TUI is the one part built by a script, `apps/opencode/build.tui.ts`, since its JSX needs
OpenTUI's Solid transform, which the `bun build` command line cannot load. Bun does not type check
while bundling, so run `bun run typecheck` as well.

## Release

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) checks formatting, lint, and types, builds every
extension, and runs the tests on every push. Pushing a tag `<app>-v<version>` (`claude-v0.1.0`,
`pi-v0.1.0`, `opencode-v0.1.0`) also creates a GitHub release and publishes `apps/<app>` to npm. Bump
`version` in the app's `package.json` first, and for Claude in `.claude-plugin/plugin.json` too; the
release fails when the tag and the manifests disagree. Publishing uses npm trusted publishing, so each
package needs this repository and workflow set as its trusted publisher on npmjs.com.

Building and running an extension is documented in its own README: start with
[`apps/opencode/README.md`](apps/opencode/README.md) for OpenCode,
[`apps/pi/README.md`](apps/pi/README.md) for pi, and
[`apps/claude/README.md`](apps/claude/README.md) for Claude Code.

## Requirements

All extensions need the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
(`brew install supabase/tap/supabase`) and Docker, since the CLI runs the local stack in containers.
Host-specific requirements are listed in each extension's README.

## License

MIT — see [LICENSE](LICENSE).
