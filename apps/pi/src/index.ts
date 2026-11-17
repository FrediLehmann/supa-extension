import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SupabaseStatus } from '@supabase-agent-extension/supabase';
import {
	type Action,
	type Host,
	type LifecycleResult,
	busyMessage,
	createActions,
	isAction,
	lifecycleCommands,
	refreshInterval,
	toolDescription,
	toolParameters
} from '@supabase-agent-extension/supabase/host';
import { directories, open, start, status, stop } from '@supabase-agent-extension/supabase/node';

import { indicator, statusKey } from './shared';

export type { Host };

/** Builds the pi extension around the Supabase actions it needs. */
export const create =
	(host: Host) =>
	(pi: ExtensionAPI): void => {
		let timer: ReturnType<typeof setInterval> | undefined;
		const actions = createActions(host);

		/** The session directory and its parents up to the project root, with every status read shown in the footer. */
		const scope = (ctx: ExtensionContext) => ({
			directories: directories(ctx.cwd),
			saved: (next: SupabaseStatus) => {
				if (!ctx.hasUI) return;
				ctx.ui.setStatus(
					statusKey,
					indicator(next, (color, text) => ctx.ui.theme.fg(color, text))
				);
			}
		});

		const stopPolling = () => {
			if (timer) clearInterval(timer);
			timer = undefined;
		};

		/** Shows the indicator right away, then keeps polling for changes made outside the session. */
		const poll = (ctx: ExtensionContext) => {
			stopPolling();
			// Headless runs have no footer, and the CLI calls behind each poll are not free.
			if (!ctx.hasUI) return;
			void actions.refresh(scope(ctx));
			timer = setInterval(() => void actions.refresh(scope(ctx)), refreshInterval);
			timer.unref?.();
		};

		/** Tells the human how a start or stop went, whether the command or the model asked for it. */
		const notify = (ctx: ExtensionContext, result: LifecycleResult) =>
			ctx.ui.notify(
				result.message,
				result.ok ? 'info' : result.message === busyMessage ? 'warning' : 'error'
			);

		for (const command of lifecycleCommands) {
			pi.registerCommand(command.slash, {
				description: command.description,
				handler: async (_args, ctx) => {
					notify(ctx, await actions.lifecycle(command.action, scope(ctx)));
				}
			});
		}

		pi.registerCommand('supabase-open', {
			description: 'Open Supabase Studio and Mailpit in the browser',
			handler: async (_args, ctx) => {
				const result = await actions.open(scope(ctx));
				if (result.ok) ctx.ui.notify('Opened Supabase Studio and Mailpit.', 'info');
				else ctx.ui.notify(result.message, 'warning');
			}
		});

		pi.registerTool({
			name: 'supabase',
			label: 'Supabase',
			description: toolDescription,
			promptSnippet:
				'Read the local Supabase status, start or stop the stack, open Studio and Mailpit',
			promptGuidelines: [
				'Use supabase with action "status" when the user asks whether the local Supabase stack is running or where Studio and Mailpit are served.',
				'Use supabase with action "start" or "stop" when the user asks to start or stop the local Supabase stack.'
			],
			parameters: toolParameters,
			executionMode: 'sequential',
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const requested = (params as { action?: unknown }).action;
				// The schema rejects other values; the fallback only satisfies the type checker.
				const action: Action = isAction(requested) ? requested : 'status';
				const result = await actions.run(action, scope(ctx));
				if (action === 'start' || action === 'stop') notify(ctx, result);
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
