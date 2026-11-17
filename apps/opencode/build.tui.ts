/**
 * Bundles the TUI part into `dist/tui.js`, with the shared Supabase package inlined.
 *
 * The TUI's JSX needs OpenTUI's Solid transform, which `bun build` on the command line cannot load, so this part is
 * built here; the server part (`build:server`) and the GUI part (`vite.config.ts`) are not. OpenCode provides
 * `@opencode/plugin`, Solid, and OpenTUI to plugins, so they stay external. `--watch` rebuilds when this package's or
 * the shared package's sources change.
 */
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';

import { createSolidTransformPlugin } from '@opentui/solid/bun-plugin';

const shared = dirname(Bun.resolveSync('@supabase-agent-extension/supabase', import.meta.dir));

const build = async () => {
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, 'src', 'tui.tsx')],
		outdir: join(import.meta.dir, 'dist'),
		target: 'bun',
		format: 'esm',
		external: [
			'@opencode/plugin',
			'@opencode/plugin/*',
			'@opentui/*',
			'solid-js',
			'solid-js/*',
			'effect',
			'effect/*'
		],
		plugins: [createSolidTransformPlugin()]
	});
	for (const log of result.logs) console.error(log);
	for (const output of result.outputs) console.log(`Built ${output.path}`);
	return result.success;
};

if (process.argv.includes('--watch')) {
	await build();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const rebuild = () => {
		clearTimeout(timer);
		timer = setTimeout(build, 50);
	};
	for (const directory of [join(import.meta.dir, 'src'), shared]) {
		watch(directory, { recursive: true }, rebuild);
	}
} else if (!(await build())) {
	process.exit(1);
}
