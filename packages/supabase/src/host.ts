/** Helpers every host adapter shares: a status snapshot, polling interval, and the lifecycle wrappers. */
import type { SupabaseStatus } from './index';

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

/** A start or stop that reports failures the same way the CLI does. */
export const runLifecycle = async (call: () => Promise<unknown>): Promise<LifecycleResult> => {
	try {
		return (await call()) as LifecycleResult;
	} catch (error) {
		return { ok: false, message: errorMessage(error) };
	}
};
