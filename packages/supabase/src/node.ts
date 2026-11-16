import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { type SupabaseConfig, status as detect, project } from './index';
import { parse } from './toml';

const run = promisify(execFile);

/**
 * Places the Supabase CLI may live in when the host app was started from a launcher with a minimal `PATH`, such as
 * the dock or Finder on macOS.
 */
const fallbackPath = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')];

const environment = () => ({
	...process.env,
	PATH: [process.env.PATH, ...fallbackPath].filter(Boolean).join(':')
});

/** Start can pull images on the first run, and stop backs up the database, so both get a long budget. */
const timeout = 10 * 60_000;

/** Reads and parses a project's `supabase/config.toml`. */
const config = async (directory: string) => {
	const text = await readFile(join(directory, 'supabase', 'config.toml'), 'utf8').catch(
		() => undefined
	);
	if (text === undefined) return undefined;
	try {
		return parse(text) as SupabaseConfig;
	} catch {
		// A malformed config is reported as no project, matching the host contract for an absent one.
		return undefined;
	}
};

/**
 * Whether the first directory with a `supabase/config.toml` has its local stack running. Pass a session directory and
 * its project root, so a session in a subdirectory still finds the project.
 */
export function status(...directories: Array<string | undefined>) {
	return detect(
		{
			config,
			containers: async (project) => {
				try {
					const { stdout } = await run(
						'docker',
						['ps', '--quiet', '--filter', `label=com.supabase.cli.project=${project}`],
						{ timeout: 3000, env: environment() }
					);
					return stdout.trim().length > 0;
				} catch {
					return false;
				}
			}
		},
		...directories
	);
}

/** The non-empty, trimmed lines of CLI output. */
const lines = (output: string) =>
	output
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

/** The CLI's explanation from its JSON output, when it prints one. */
const detail = (output: string) => {
	for (const line of output.split('\n')) {
		const text = line.trim();
		if (!text.startsWith('{')) continue;
		try {
			const parsed = JSON.parse(text) as { message?: unknown; error?: { message?: unknown } };
			if (typeof parsed.error?.message === 'string' && parsed.error.message)
				return parsed.error.message;
			if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
		} catch {
			// Not a JSON line.
		}
	}
	return undefined;
};

/** The one line of CLI output worth showing, so a success toast does not get the whole startup table. */
const summary = (output: string, action: 'start' | 'stop') => {
	const text = output.trim();
	return (
		detail(text) ??
		lines(text).find((line) => /supabase local development setup/i.test(line)) ??
		(action === 'start' ? 'Supabase started.' : 'Supabase stopped.')
	);
};

/** The CLI's explanation of the failure. */
const failure = (error: unknown, action: 'start' | 'stop') => {
	const failed = error as { code?: string; stdout?: string; stderr?: string; message?: string };
	if (failed.code === 'ENOENT') {
		return {
			ok: false,
			message:
				'The Supabase CLI was not found. Install it with `brew install supabase/tap/supabase`.'
		};
	}
	const output = [failed.stdout, failed.stderr].filter(Boolean).join('\n').trim();
	const explanation = detail(output) ?? lines(output).slice(-3).join('\n');
	return { ok: false, message: explanation || failed.message || `Could not ${action} Supabase.` };
};

/** Runs `supabase start` or `supabase stop` in the first directory with a `supabase/config.toml`. */
const lifecycle = async (action: 'start' | 'stop', directories: Array<string | undefined>) => {
	const found = await project(config, ...directories);
	if (!found) return { ok: false, message: 'No supabase/config.toml was found for this session.' };
	try {
		const { stdout, stderr } = await run('supabase', [action], {
			cwd: found.directory,
			timeout,
			maxBuffer: 4 * 1024 * 1024,
			env: environment()
		});
		return { ok: true, message: summary(`${stdout}\n${stderr}`, action) };
	} catch (error) {
		return failure(error, action);
	}
};

/** Starts the local stack of the first directory with a `supabase/config.toml`. */
export function start(...directories: Array<string | undefined>) {
	return lifecycle('start', directories);
}

/** Stops the local stack of the first directory with a `supabase/config.toml`. */
export function stop(...directories: Array<string | undefined>) {
	return lifecycle('stop', directories);
}
