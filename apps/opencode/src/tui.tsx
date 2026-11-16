/** @jsxImportSource @opentui/solid */
import { Show, createEffect, createSignal, onCleanup } from 'solid-js';

import { Plugin, usePlugin } from '@opencode/plugin/tui';
import type { Context } from '@opencode/plugin/tui/context';
import type { SupabaseStatus } from '@supa-extension/supabase';

import {
	fetchStatus,
	offline,
	refreshInterval,
	runLifecycle
} from '../../../packages/supabase/src/host';
import { Supabase } from './rpc';
import { type Target, lifecycleCommands } from './shared';

/**
 * The most specific project whose root contains the directory, so a location in a subdirectory still finds it and
 * nested projects do not resolve to their parent.
 */
const projectAt = (projects: readonly { canonical: string }[], directory: string) =>
	projects
		.filter((project) => {
			const root = project.canonical.replace(/[\\/]+$/, '');
			return (
				directory === root || directory.startsWith(`${root}/`) || directory.startsWith(`${root}\\`)
			);
		})
		.sort((left, right) => right.canonical.length - left.canonical.length)[0];

/**
 * Where status and the lifecycle commands act: the open session's directory and project root, so a session in a
 * subdirectory still finds the project, or the TUI's location when no session is open.
 */
const targetOf = (ctx: Context, sessionID?: string): Target => {
	const session = sessionID ? ctx.data.session.get(sessionID) : undefined;
	if (session) {
		return {
			directory: session.location.directory,
			worktree: ctx.data.project.get(session.projectID)?.canonical
		};
	}
	const directory = (ctx.location ?? ctx.data.location.default()).directory;
	return {
		directory,
		worktree: projectAt(ctx.data.project.list(), directory)?.canonical
	};
};

/** A green dot while the location's local Supabase stack is running, grey when it is stopped. */
function Indicator(props: { sessionID?: string; revision: () => number }) {
	const ctx = usePlugin();
	const [state, setState] = createSignal<SupabaseStatus>(offline);
	let shown: string | undefined;

	createEffect(() => {
		const { directory, worktree } = targetOf(ctx, props.sessionID);
		let current = true;

		// A finished start or stop bumps the revision, so the indicator shows the new state without waiting for a poll.
		props.revision();
		// Keep the last answer when the same location just re-rendered; drop it when the location changed.
		if (shown !== directory) setState(offline);

		const refresh = async () => {
			const next = await fetchStatus(() =>
				ctx.client.rpc(Supabase).status({ directory, worktree })
			);
			if (!current || !next) return;
			shown = next.configured ? directory : undefined;
			setState(next);
		};

		void refresh();
		const timer = setInterval(() => void refresh(), refreshInterval);
		onCleanup(() => {
			current = false;
			clearInterval(timer);
		});
	});

	return (
		<Show when={state().configured}>
			<text fg={state().running ? ctx.theme.text.feedback.success.base : ctx.theme.text.muted}>
				{state().running ? '● Supabase' : '○ Supabase'}
			</text>
		</Show>
	);
}

export default Plugin.define({
	id: 'supabase.tui',
	setup(ctx) {
		const [pending, setPending] = createSignal(false);
		const [revision, setRevision] = createSignal(0);

		const lifecycle = (action: 'start' | 'stop') => async () => {
			// A start or stop runs for up to minutes, so ignore a second request while one is in flight.
			if (pending()) return;
			const current = ctx.ui.router.current();
			const input = targetOf(ctx, current.type === 'session' ? current.sessionID : undefined);
			setPending(true);
			ctx.ui.toast.show({
				title: 'Supabase',
				message: action === 'start' ? 'Starting Supabase…' : 'Stopping Supabase…',
				variant: 'info',
				duration: 10_000
			});
			try {
				const rpc = ctx.client.rpc(Supabase);
				const result = await runLifecycle(() =>
					action === 'start' ? rpc.start(input) : rpc.stop(input)
				);
				ctx.ui.toast.show({
					title: 'Supabase',
					message: result.message,
					variant: result.ok ? 'success' : 'error',
					duration: 8_000
				});
			} finally {
				setPending(false);
				// Refresh the indicator now instead of waiting for its next poll.
				setRevision((value) => value + 1);
			}
		};

		const onHome = () => ctx.ui.router.current().type === 'home';

		const slots = [
			ctx.ui.slot({
				append: 'home.footer.status',
				render: () => (
					<Show when={onHome()}>
						<Indicator revision={revision} />
					</Show>
				)
			}),
			ctx.ui.slot({
				append: 'prompt.footer.status',
				render: (input) => (
					<Show when={!onHome()}>
						<Indicator sessionID={input.sessionID} revision={revision} />
					</Show>
				)
			})
		];

		ctx.keymap.layer(() => ({
			mode: 'global',
			priority: 10,
			commands: lifecycleCommands.map((command) => ({
				id: `supabase.${command.action}`,
				title: command.title,
				description: command.description,
				group: 'Supabase',
				palette: true,
				slash: { name: command.slash },
				enabled: () => !pending(),
				run: lifecycle(command.action)
			}))
		}));

		return () => {
			for (const dispose of slots) dispose();
		};
	}
});
