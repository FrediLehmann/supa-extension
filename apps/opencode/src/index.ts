import { Plugin } from '@opencode/plugin';
import { start, status, stop } from '@supabase-agent-extension/supabase/node';

import { Supabase } from './rpc';

/** The session directory and its project root, so a session in a subdirectory still finds the project. */
const directories = (input: unknown) => {
	const { directory, worktree } = input as { directory: string; worktree?: string };
	return [directory, worktree] as const;
};

export default Plugin.define({
	id: 'supabase',
	async setup(ctx) {
		await ctx.rpc.register(Supabase, {
			status: (input) => status(...directories(input)),
			start: (input) => start(...directories(input)),
			stop: (input) => stop(...directories(input))
		});
	}
});
