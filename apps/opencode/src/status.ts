import { createEffect, createSignal, onCleanup } from 'solid-js';

import type { SupabaseStatus } from '@supabase-agent-extension/supabase';
import { fetchStatus, offline, refreshInterval } from '@supabase-agent-extension/supabase/host';

import type { Target } from './shared';

/**
 * Polls the stack status of the current target while the component is mounted, keeping the last answer until the
 * target's directory changes. A finished start or stop bumps `revision`, so the new state shows without a wait.
 */
export const createStatusPoll = (options: {
	target: () => Target;
	fetch: (target: Target) => Promise<unknown>;
	active?: () => boolean;
	revision?: () => number;
}) => {
	const [status, setStatus] = createSignal<SupabaseStatus>(offline);
	let shown: string | undefined;

	createEffect(() => {
		// A hidden view stays mounted, so it should not poll until it is visible again.
		if (options.active && !options.active()) return;
		const target = options.target();
		const { directory } = target;
		let current = true;

		options.revision?.();
		// Keep the last answer when the same location just re-rendered; drop it when the location changed.
		if (shown !== directory) setStatus(offline);

		const refresh = async () => {
			const next = await fetchStatus(() => options.fetch(target));
			// A poll that lands after a move or unmount must not overwrite the next location's status.
			if (!current || !next || options.target().directory !== directory) return;
			shown = next.configured ? directory : undefined;
			setStatus(next);
		};

		void refresh();
		const timer = setInterval(() => void refresh(), refreshInterval);
		onCleanup(() => {
			current = false;
			clearInterval(timer);
		});
	});

	return status;
};
