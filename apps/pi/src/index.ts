import { spawn } from 'node:child_process';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

import {
	type LifecycleResult,
	browserTargets,
	fetchStatus,
	offline,
	refreshInterval,
	runLifecycle
} from '../../../packages/supabase/src/host';
import type { SupabaseStatus } from '../../../packages/supabase/src/index';
import { start, status, stop } from '../../../packages/supabase/src/node';
import {
	type Action,
	directories,
	indicator,
	isAction,
	lifecycleCommands,
	openCommand,
	statusKey,
	statusReport
} from './shared';

/** The Supabase work the extension performs. Swapped out in tests. */
export type Host = {
	status(...directories: Array<string | undefined>): Promise<SupabaseStatus>;
	start(...directories: Array<string | undefined>): Promise<LifecycleResult>;
	stop(...directories: Array<string | undefined>): Promise<LifecycleResult>;
	/** Hands a URL to the desktop browser. */
	open(url: string): void;
};

/** Opens a URL in the desktop browser without blocking the session. */
const open = (url: string) => {
	const { command, args } = openCommand(process.platform, url);
	const child = spawn(command, args, { detached: true, stdio: 'ignore' });
	child.on('error', () => undefined);
	child.unref();
};

/** Builds the pi extension around the Supabase actions it needs. */
export const create =
	(host: Host) =>
	(pi: ExtensionAPI): void => {
		let timer: ReturnType<typeof setInterval> | undefined;
		let pending = false;

		/** The session directory and its parents up to the project root. */
		const target = (ctx: ExtensionContext) => directories(ctx.cwd);

		/** Reads the status and keeps the footer indicator in step with it. */
		const refresh = async (ctx: ExtensionContext) => {
			const next = (await fetchStatus(() => host.status(...target(ctx)))) ?? offline;
			if (ctx.hasUI) {
				ctx.ui.setStatus(
					statusKey,
					indicator(next, (color, text) => ctx.ui.theme.fg(color, text))
				);
			}
			return next;
		};

		const stopPolling = () => {
			if (timer) clearInterval(timer);
			timer = undefined;
		};

		/** Shows the indicator right away, then keeps polling for changes made outside the session. */
		const poll = (ctx: ExtensionContext) => {
			stopPolling();
			// Headless runs have no footer, and the CLI calls behind each poll are not free.
			if (!ctx.hasUI) return;
			void refresh(ctx);
			timer = setInterval(() => void refresh(ctx), refreshInterval);
			timer.unref?.();
		};

		const lifecycle = async (ctx: ExtensionContext, action: 'start' | 'stop') => {
			// A start or stop runs for up to minutes, so ignore a second request while one is in flight.
			if (pending) {
				const result = { ok: false, message: 'Supabase is already starting or stopping.' };
				ctx.ui.notify(result.message, 'warning');
				return result;
			}
			pending = true;
			try {
				const result = await runLifecycle(() =>
					action === 'start' ? host.start(...target(ctx)) : host.stop(...target(ctx))
				);
				ctx.ui.notify(result.message, result.ok ? 'info' : 'error');
				return result;
			} finally {
				pending = false;
				// Refresh the indicator now instead of waiting for its next poll.
				void refresh(ctx);
			}
		};

		const openAll = async (ctx: ExtensionContext) => {
			const current = await refresh(ctx);
			if (!current.running) return undefined;
			for (const url of browserTargets(current)) host.open(url);
			return current;
		};

		for (const command of lifecycleCommands) {
			pi.registerCommand(command.name, {
				description: command.description,
				handler: async (_args, ctx) => {
					await lifecycle(ctx, command.action);
				}
			});
		}

		pi.registerCommand('supabase-open', {
			description: 'Open Supabase Studio and Mailpit in the browser',
			handler: async (_args, ctx) => {
				const current = await openAll(ctx);
				if (!current) {
					ctx.ui.notify('The local Supabase stack is not running.', 'warning');
					return;
				}
				ctx.ui.notify('Opened Supabase Studio and Mailpit.', 'info');
			}
		});

		pi.registerTool({
			name: 'supabase',
			label: 'Supabase',
			description: 'Read or control the local Supabase stack of this project.',
			promptSnippet:
				'Read the local Supabase status, start or stop the stack, open Studio and Mailpit',
			promptGuidelines: [
				'Use supabase with action "status" when the user asks whether the local Supabase stack is running or where Studio and Mailpit are served.',
				'Use supabase with action "start" or "stop" when the user asks to start or stop the local Supabase stack.'
			],
			parameters: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						enum: ['status', 'start', 'stop', 'open'],
						description:
							'status reads the stack state, start and stop run the Supabase CLI, open launches Studio and Mailpit in the browser'
					}
				},
				required: ['action'],
				additionalProperties: false
			},
			executionMode: 'sequential',
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const requested = (params as { action?: unknown }).action;
				// The schema rejects other values; the fallback only satisfies the type checker.
				const action: Action = isAction(requested) ? requested : 'status';
				if (action === 'open') {
					const current = await openAll(ctx);
					if (!current) {
						return {
							content: [{ type: 'text', text: 'The local Supabase stack is not running.' }],
							details: {},
							isError: true
						};
					}
					return {
						content: [
							{
								type: 'text',
								text: `Opened Studio and Mailpit.\nStudio: ${current.studio}\nMailpit: ${current.mailpit}`
							}
						],
						details: {}
					};
				}
				if (action === 'status') {
					const current = await refresh(ctx);
					return { content: [{ type: 'text', text: statusReport(current) }], details: {} };
				}
				const result = await lifecycle(ctx, action);
				return {
					content: [{ type: 'text', text: result.message }],
					details: {},
					isError: !result.ok
				};
			}
		});

		pi.on('session_start', (_event, ctx) => {
			poll(ctx);
		});

		// A switched or reloaded session is replaced through a shutdown, and the new one starts polling on its own.
		pi.on('session_shutdown', () => {
			stopPolling();
		});
	};

export default create({ status, start, stop, open });
