/** The directory and project root an RPC acts on, so a session in a subdirectory still finds the project. */
export type Target = { directory: string; worktree?: string };

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

/** A copy of the pending map with the directory's action set, or cleared when it is omitted. */
export const markPending = (
	current: ReadonlyMap<string, 'start' | 'stop'>,
	directory: string,
	action?: 'start' | 'stop'
) => {
	const next = new Map(current);
	if (action) next.set(directory, action);
	else next.delete(directory);
	return next;
};

/** The badge's tooltip for the current stack state and any action in flight. */
export const badgeTooltip = (running: boolean, pending?: 'start' | 'stop') => {
	if (pending === 'start') return 'Starting…';
	if (pending === 'stop') return 'Stopping…';
	return running ? 'Open Studio and Mailpit' : 'Stopped';
};
