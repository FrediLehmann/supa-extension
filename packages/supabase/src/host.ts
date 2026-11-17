/** Helpers every host adapter shares: a status snapshot, polling interval, and the lifecycle wrappers. */
import type { SupabaseStatus } from './index.ts';

/** How often a host's status indicator re-reads the stack status. */
export const refreshInterval = 10_000;

/** The status before the first answer arrives, or while no project is configured. */
export const offline: SupabaseStatus = {
	configured: false,
	running: false,
	studio: '',
	mailpit: ''
};

/** What a start or stop reports, including failures a host call rejected with. */
export type LifecycleResult = { ok: boolean; message: string };

/** The Supabase work a host adapter performs. Swapped out in tests. */
export type Host = {
	status(...directories: Array<string | undefined>): Promise<SupabaseStatus>;
	start(...directories: Array<string | undefined>): Promise<LifecycleResult>;
	stop(...directories: Array<string | undefined>): Promise<LifecycleResult>;
	/** Hands a URL to the desktop browser. */
	open(url: string): void;
};

/** What a start or stop reports while another one is still running. */
export const busyMessage = 'Supabase is already starting or stopping.';

/** What an open reports when the stack is stopped. */
export const stoppedMessage = 'The local Supabase stack is not running.';

/** The status indicator's dot and label, so every host names the stack the same way. */
export const indicatorLabel = (running: boolean) => (running ? '● Supabase' : '○ Supabase');

/** What an open reports after it handed the stack's URLs to the browser. */
export const openReport = (status: SupabaseStatus) =>
	`Opened Studio and Mailpit.\nStudio: ${status.studio}\nMailpit: ${status.mailpit}`;

/**
 * The URLs a host opens for a status: Studio and Mailpit while the stack runs and no action is in flight.
 *
 * `busy` is true while the host runs a start or stop, so a host that shows a spinner does not open a stale page.
 */
export const browserTargets = (status: SupabaseStatus, busy?: boolean) =>
	status.running && !busy ? [status.studio, status.mailpit] : [];

/** The message in a failure that is not an Error. */
export const errorMessage = (error: unknown) => {
	if (
		error &&
		typeof error === 'object' &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
};

/** A status read that resolves to undefined when the host call fails. */
export const fetchStatus = async (call: () => Promise<unknown>) =>
	(await call().catch(() => undefined)) as SupabaseStatus | undefined;

/** A status read that falls back to the offline status when the host call fails. */
export const readStatus = async (call: () => Promise<unknown>) =>
	(await fetchStatus(call)) ?? offline;

/** A start or stop that reports failures the same way the CLI does. */
export const runLifecycle = async (call: () => Promise<unknown>): Promise<LifecycleResult> => {
	try {
		return (await call()) as LifecycleResult;
	} catch (error) {
		return { ok: false, message: errorMessage(error) };
	}
};

/** The actions a host's `supabase` tool takes. */
export const actions = ['status', 'start', 'stop', 'open'] as const;

export type Action = (typeof actions)[number];

/** Whether a tool argument names an action a host handles. */
export const isAction = (value: unknown): value is Action =>
	actions.some((action) => action === value);

/** The description a host's `supabase` tool gives its action argument. */
export const actionDescription =
	'status reads the stack state, start and stop run the Supabase CLI, open launches Studio and Mailpit in the browser';

/** The description of a host's `supabase` tool. */
export const toolDescription =
	'Read or control the local Supabase stack of this project: status reports whether it runs and where Studio and Mailpit are served, start and stop run the Supabase CLI (they can take minutes), open launches Studio and Mailpit in the browser.';

/** The JSON schema of the `supabase` tool's arguments. */
export const toolParameters = {
	type: 'object' as const,
	properties: {
		action: { type: 'string' as const, enum: [...actions], description: actionDescription }
	},
	required: ['action'],
	additionalProperties: false
};

/** The Start and Stop commands every host exposes to the human. */
export const lifecycleCommands = [
	{
		action: 'start',
		title: 'Start Supabase',
		description: 'Start the local Supabase stack',
		slash: 'supabase-start'
	},
	{
		action: 'stop',
		title: 'Stop Supabase',
		description: 'Stop the local Supabase stack',
		slash: 'supabase-stop'
	}
] as const;

/** The status as a message, including the URLs the stack serves. */
export const statusReport = (status: SupabaseStatus) => {
	if (!status.configured) return 'No supabase/config.toml was found for this session.';
	const state = status.running ? 'running' : 'stopped';
	return `The local Supabase stack is ${state}.\nStudio: ${status.studio}\nMailpit: ${status.mailpit}`;
};

/** How to hand a URL to the desktop browser on each platform. */
export const openCommand = (platform: NodeJS.Platform, url: string) => {
	if (platform === 'darwin') return { command: 'open', args: [url] };
	if (platform === 'win32') return { command: 'explorer', args: [url] };
	return { command: 'xdg-open', args: [url] };
};

/** Where an action looks for the project, and who hears about every status it reads. */
export type Scope = {
	directories: ReadonlyArray<string | undefined>;
	/** Called with every status read, so a host can update its indicator without a read of its own. */
	saved?(status: SupabaseStatus): void;
};

/**
 * The `supabase` tool's actions around a host's Supabase work, sharing one in-flight guard: while a start or stop
 * runs, another start, stop, or open reports that Supabase is already changing state. A status read is answered while
 * one runs.
 */
export const createActions = (host: Host) => {
	let pending = false;

	const refresh = async (scope: Scope) => {
		const next = await readStatus(() => host.status(...scope.directories));
		scope.saved?.(next);
		return next;
	};

	const lifecycle = async (action: 'start' | 'stop', scope: Scope): Promise<LifecycleResult> => {
		// A start or stop runs for up to minutes, so refuse a second request while one is in flight.
		if (pending) return { ok: false, message: busyMessage };
		pending = true;
		try {
			return await runLifecycle(() => host[action](...scope.directories));
		} finally {
			// Show the new state right away instead of waiting for the next poll. The guard stays up until this read
			// lands, so a second start or stop cannot overlap it and leave a stale status behind.
			try {
				await refresh(scope);
			} finally {
				pending = false;
			}
		}
	};

	const open = async (scope: Scope): Promise<LifecycleResult> => {
		const current = await refresh(scope);
		const urls = browserTargets(current, pending);
		if (!urls.length) {
			const message = pending
				? busyMessage
				: current.configured
					? stoppedMessage
					: statusReport(current);
			return { ok: false, message };
		}
		for (const url of urls) host.open(url);
		return { ok: true, message: openReport(current) };
	};

	/** Runs one tool action and reports it as a message. */
	const run = async (action: Action, scope: Scope): Promise<LifecycleResult> => {
		if (action === 'status') return { ok: true, message: statusReport(await refresh(scope)) };
		if (action === 'open') return open(scope);
		return lifecycle(action, scope);
	};

	return { refresh, lifecycle, open, run };
};
