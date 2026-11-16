import { type Accessor, Show, createEffect, createSignal, onCleanup } from 'solid-js';

import { Command, type MountedSession, Plugin, Slot, Style, usePlugin } from '@opencode/plugin/gui';
import { Browser } from '@opencode/plugin/gui/browser';
import type { SupabaseStatus } from '@supa-extension/supabase';

import supabaseIcon from '../../../packages/assets/supabase-icon-green-transparent.svg?raw';
import { Supabase } from './rpc';
import {
	type LifecycleResult,
	type Target,
	fetchStatus,
	lifecycleCommands,
	offline,
	refreshInterval,
	runLifecycle
} from './shared';

const iconURL = `data:image/svg+xml,${encodeURIComponent(supabaseIcon)}`;

const spinnerStyles = `
@keyframes supabase-badge-spin {
  to { transform: rotate(360deg); }
}
.supabase-badge-spinner {
  transform-origin: center;
  animation: supabase-badge-spin 1s linear infinite;
}
.toast-v2--loading [data-icon] svg {
  transform-origin: center;
  animation: supabase-badge-spin 1s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .supabase-badge-spinner,
  .toast-v2--loading [data-icon] svg { animation-duration: 2.4s; }
}
`;

function Spinner() {
	return (
		<svg
			aria-hidden="true"
			class="supabase-badge-spinner"
			viewBox="0 0 24 24"
			fill="currentColor"
			style={{ width: '12px', height: '12px', display: 'block' }}
		>
			<path d="M18.364 5.63604L16.9497 7.05025C15.683 5.7835 13.933 5 12 5C8.13401 5 5 8.13401 5 12C5 15.866 8.13401 19 12 19C15.866 19 19 15.866 19 12H21C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.4853 3 16.7353 4.00736 18.364 5.63604Z" />
		</svg>
	);
}

function Badge(props: {
	session: MountedSession;
	active: boolean;
	compact: boolean;
	pending: Accessor<ReadonlyMap<string, 'start' | 'stop'>>;
	revision: Accessor<number>;
}) {
	const ctx = usePlugin();
	const browser = ctx.use(Browser);
	// A plain signal, not `createResource`: refetching a resource increments the
	// nearest Suspense counter, and OpenCode Desktop wraps the whole window in a
	// Suspense boundary, so every poll would swap the window for its fallback.
	const [state, setState] = createSignal<SupabaseStatus>(offline);
	let shown: string | undefined;

	const action = () => props.pending().get(props.session.directory);

	const refresh = async (directory: string, worktree?: string) => {
		const next = await fetchStatus(() => ctx.client.rpc(Supabase).status({ directory, worktree }));
		if (!next || directory !== props.session.directory) return;
		shown = next.configured ? directory : undefined;
		setState(next);
	};

	const open = () => {
		const status = state();
		if (!status.running || action()) return;
		const provider = browser();
		if (provider.status !== 'active') {
			ctx.toast.show({ title: 'Supabase', description: 'The browser panel is unavailable.' });
			return;
		}
		// Studio refuses to be framed (X-Frame-Options: DENY), so both open in the desktop browser pane.
		provider.value.open(props.session, status.studio);
		provider.value.open(props.session, status.mailpit);
	};

	// Cached timelines stay mounted while hidden, so only the visible one polls.
	// Reading the directory here also refreshes the badge when a session moves.
	createEffect(() => {
		if (!props.active) return;
		const directory = props.session.directory;
		const worktree = props.session.project?.worktree;
		// A finished start or stop bumps the revision, so the badge stops spinning on a fresh status.
		props.revision();
		// Keep the last answer when the same timeline just became visible again.
		if (shown !== directory) setState(offline);
		void refresh(directory, worktree);
		const timer = setInterval(() => void refresh(directory, worktree), refreshInterval);
		onCleanup(() => clearInterval(timer));
	});

	const tooltip = () => {
		const pending = action();
		if (pending === 'start') return 'Starting…';
		if (pending === 'stop') return 'Stopping…';
		return state().running ? 'Open Studio and Mailpit' : 'Stopped';
	};

	return (
		<Show when={state().configured}>
			<ctx.ui.Tooltip value={tooltip()} placement="bottom">
				<ctx.ui.Button
					variant="ghost-muted"
					size="small"
					disabled={!state().running || action() !== undefined}
					onClick={open}
				>
					{action() ? (
						<Spinner />
					) : (
						<img
							alt={props.compact ? 'Supabase' : ''}
							src={iconURL}
							style={{
								width: '12px',
								height: '12px',
								display: 'block',
								filter: state().running ? undefined : 'grayscale(1)',
								opacity: state().running ? 1 : 0.55
							}}
						/>
					)}
					{!props.compact && 'Supabase'}
				</ctx.ui.Button>
			</ctx.ui.Tooltip>
		</Show>
	);
}

export default Plugin.define({
	setup(ctx) {
		const [pending, setPending] = createSignal<ReadonlyMap<string, 'start' | 'stop'>>(new Map());
		const [revision, setRevision] = createSignal(0);

		const mark = (directory: string, action?: 'start' | 'stop') =>
			setPending((current) => {
				const next = new Map(current);
				if (action) next.set(directory, action);
				else next.delete(directory);
				return next;
			});

		const lifecycle = (action: 'start' | 'stop') => async () => {
			const session = ctx.sessions.current();
			if (!session) {
				ctx.toast.show({
					title: 'Supabase',
					description: 'Open a session to control its local Supabase stack.',
					variant: 'error'
				});
				return;
			}
			const toast = ctx.toast.show({
				title: action === 'start' ? 'Starting Supabase' : 'Stopping Supabase',
				description:
					action === 'start'
						? 'Your supabase project is starting.'
						: 'Your supabase project is stopping.',
				variant: 'loading',
				icon: 'outline-rotate-clockwise',
				persistent: true
			});
			mark(session.directory, action);
			try {
				const rpc = ctx.client.rpc(Supabase);
				const input: Target = {
					directory: session.directory,
					worktree: session.project?.worktree
				};
				const result: LifecycleResult = await runLifecycle(() =>
					action === 'start' ? rpc.start(input) : rpc.stop(input)
				);
				ctx.toast.show({
					title: 'Supabase',
					description: result.message,
					variant: result.ok ? 'success' : 'error',
					duration: 8_000
				});
			} finally {
				toast.dismiss();
				mark(session.directory);
				setRevision((value) => value + 1);
			}
		};

		ctx.add(Style, spinnerStyles);
		for (const command of lifecycleCommands) {
			ctx.add(Command, {
				id: command.id,
				title: command.title,
				description: command.description,
				group: 'Supabase',
				section: 'session',
				slash: { name: command.slash },
				run: lifecycle(command.action)
			});
		}
		ctx.add(Slot, {
			at: 'session.header',
			order: 10,
			render: (input) => (
				<Badge
					session={input.session}
					active={input.active}
					compact={input.compact}
					pending={pending}
					revision={revision}
				/>
			)
		});
	}
});
