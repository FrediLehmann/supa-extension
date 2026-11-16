import type { SupabaseStatus } from '@supa-extension/supabase';

/** How often the desktop badge and the TUI indicator re-read the stack status. */
export const refreshInterval = 10_000;

/** The status before the first answer arrives, or while no project is configured. */
export const offline: SupabaseStatus = {
	configured: false,
	running: false,
	studio: '',
	mailpit: ''
};

/** The directory and project root an RPC acts on, so a session in a subdirectory still finds the project. */
export type Target = { directory: string; worktree?: string };

/** What `start` and `stop` report, including RPC failures the client rejected with. */
export type LifecycleResult = { ok: boolean; message: string };

/** The Start and Stop commands the TUI and the desktop palette expose. */
export const lifecycleCommands = [
	{
		action: 'start',
		id: 'start',
		title: 'Start Supabase',
		description: 'Start the local Supabase stack',
		slash: 'supabase-start'
	},
	{
		action: 'stop',
		id: 'stop',
		title: 'Stop Supabase',
		description: 'Stop the local Supabase stack',
		slash: 'supabase-stop'
	}
] as const;

/** The client rethrows RPC failures as plain `{ type, message }` objects, not Errors. */
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

/** A status read that resolves to undefined when the server or the RPC call fails. */
export const fetchStatus = async (call: () => Promise<unknown>) =>
	(await call().catch(() => undefined)) as SupabaseStatus | undefined;

/** A start or stop that reports RPC failures the same way the server reports CLI failures. */
export const runLifecycle = async (call: () => Promise<unknown>): Promise<LifecycleResult> => {
	try {
		return (await call()) as LifecycleResult;
	} catch (error) {
		return { ok: false, message: errorMessage(error) };
	}
};
