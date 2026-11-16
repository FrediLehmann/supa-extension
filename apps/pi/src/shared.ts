import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { SupabaseStatus } from '../../../packages/supabase/src/index';

/** The footer key the indicator is stored under. */
export const statusKey = 'supabase';

/** The lifecycle commands the extension registers. */
export const lifecycleCommands = [
	{
		action: 'start',
		name: 'supabase-start',
		description: 'Start the local Supabase stack'
	},
	{
		action: 'stop',
		name: 'supabase-stop',
		description: 'Stop the local Supabase stack'
	}
] as const;

/** The actions the `supabase` tool takes. */
export const actions = ['status', 'start', 'stop', 'open'] as const;

export type Action = (typeof actions)[number];

/** Whether a tool argument names an action the extension handles. */
export const isAction = (value: unknown): value is Action =>
	actions.some((action) => action === value);

/**
 * The directories a status read checks: the session directory and its parents up to the git root, so a session in a
 * subdirectory still finds the project. The walk never goes above the home directory, so a stray `~/supabase` is not
 * mistaken for the project of every session.
 */
export const directories = (cwd: string) => {
	const found: string[] = [];
	const home = resolve(homedir());
	let directory = resolve(cwd);
	for (;;) {
		found.push(directory);
		if (existsSync(join(directory, '.git'))) break;
		const parent = dirname(directory);
		if (parent === directory) break;
		if (directory === home || parent === home) break;
		directory = parent;
	}
	return found;
};

/**
 * The footer text for a status: a green dot while running, a muted hollow dot while stopped, and nothing when the
 * session has no Supabase project.
 */
export const indicator = (
	status: SupabaseStatus,
	fg: (color: 'success' | 'dim', text: string) => string
) => {
	if (!status.configured) return undefined;
	return status.running ? fg('success', '● Supabase') : fg('dim', '○ Supabase');
};

/** The status as a message, including the URLs the stack serves. */
export const statusReport = (status: SupabaseStatus) => {
	if (!status.configured) return 'No supabase/config.toml was found for this session.';
	const state = status.running ? 'running' : 'stopped';
	return `The local Supabase stack is ${state}.\nStudio: ${status.studio}\nMailpit: ${status.mailpit}`;
};

/** How to hand a URL to the desktop browser on each platform pi runs on. */
export const openCommand = (platform: NodeJS.Platform, url: string) => {
	if (platform === 'darwin') return { command: 'open', args: [url] };
	if (platform === 'win32') return { command: 'explorer', args: [url] };
	return { command: 'xdg-open', args: [url] };
};
