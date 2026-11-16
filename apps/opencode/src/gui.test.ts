import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { type ViteDevServer, createServer } from 'vite';
import solid from 'vite-plugin-solid';

import type { Context } from '@opencode/plugin/gui';

import type { Target } from './shared';

type LifecycleResult = { ok: boolean; message: string };

type Toast = {
	title?: string;
	description?: string;
	variant?: string;
	persistent?: boolean;
	icon?: string;
};

type CommandItem = {
	id: string;
	group: string;
	slash?: { name: string };
	run: () => Promise<void>;
};

type Added = { registry: string; item: unknown };

type Setup = (ctx: Context) => void;

let setup: Setup;
let server: ViteDevServer;

beforeAll(async () => {
	server = await createServer({
		root: join(import.meta.dir, '..'),
		logLevel: 'silent',
		server: { middlewareMode: true },
		appType: 'custom',
		plugins: [solid()]
	});
	const module = (await server.ssrLoadModule('/src/gui.tsx')) as { default: { setup: Setup } };
	setup = module.default.setup;
});

afterAll(async () => {
	await server.close();
});

const makeContext = (
	options: {
		session?: { directory: string; project?: { worktree: string } };
		start?: (input?: Target) => Promise<LifecycleResult>;
		stop?: (input?: Target) => Promise<LifecycleResult>;
	} = {}
) => {
	const added: Added[] = [];
	const toasts: Toast[] = [];
	const calls: Array<{ method: 'start' | 'stop'; input?: Target }> = [];
	let dismissed = 0;

	const rpc = {
		start: async (input?: Target) => {
			calls.push({ method: 'start', input });
			return options.start ? options.start(input) : { ok: true, message: 'Supabase started.' };
		},
		stop: async (input?: Target) => {
			calls.push({ method: 'stop', input });
			return options.stop ? options.stop(input) : { ok: true, message: 'Supabase stopped.' };
		}
	};

	const ctx = {
		sessions: { current: () => options.session },
		toast: {
			show: (toast: Toast) => {
				toasts.push(toast);
				return {
					dismiss: () => {
						dismissed++;
					}
				};
			}
		},
		client: { rpc: () => rpc },
		add: (registry: { id: string }, item: unknown) => {
			added.push({ registry: registry.id, item });
			return () => {};
		}
	};

	return {
		ctx: ctx as unknown as Context,
		added,
		toasts,
		calls,
		dismissed: () => dismissed
	};
};

const commands = (fake: ReturnType<typeof makeContext>) =>
	fake.added
		.filter((entry) => entry.registry === 'command')
		.map((entry) => entry.item as CommandItem);

const command = (fake: ReturnType<typeof makeContext>, id: string) => {
	const found = commands(fake).find((candidate) => candidate.id === id);
	if (!found) throw new Error(`command ${id} was not registered`);
	return found;
};

describe('gui plugin', () => {
	it('registers the spinner style, commands, and header slot', () => {
		const fake = makeContext();
		setup(fake.ctx);

		expect(fake.added.map((entry) => entry.registry)).toEqual([
			'style',
			'command',
			'command',
			'slot'
		]);
		expect(fake.added[0]?.item).toContain('supabase-badge-spin');
		expect(commands(fake).map(({ id, group, slash }) => ({ id, group, slash }))).toEqual([
			{ id: 'start', group: 'Supabase', slash: { name: 'supabase-start' } },
			{ id: 'stop', group: 'Supabase', slash: { name: 'supabase-stop' } }
		]);
		expect(fake.added.at(-1)?.item).toMatchObject({ at: 'session.header', order: 10 });
	});

	it('asks for an open session when none is mounted', async () => {
		const fake = makeContext();
		setup(fake.ctx);
		await command(fake, 'start').run();

		expect(fake.calls).toEqual([]);
		expect(fake.toasts.at(-1)).toMatchObject({
			title: 'Supabase',
			description: 'Open a session to control its local Supabase stack.',
			variant: 'error'
		});
	});

	it('starts the stack for the open session', async () => {
		const fake = makeContext({
			session: { directory: '/work/project', project: { worktree: '/work/project' } }
		});
		setup(fake.ctx);
		await command(fake, 'start').run();

		expect(fake.calls).toEqual([
			{ method: 'start', input: { directory: '/work/project', worktree: '/work/project' } }
		]);
		expect(fake.toasts[0]).toMatchObject({ variant: 'loading', persistent: true });
		expect(fake.toasts.at(-1)).toMatchObject({
			variant: 'success',
			description: 'Supabase started.'
		});
		expect(fake.dismissed()).toBe(1);
	});

	it('reports a failed command as an error toast', async () => {
		const fake = makeContext({
			session: { directory: '/work/project' },
			stop: async () => {
				throw { type: 'error', message: 'docker is not running' };
			}
		});
		setup(fake.ctx);
		await command(fake, 'stop').run();

		expect(fake.calls).toEqual([{ method: 'stop', input: { directory: '/work/project' } }]);
		expect(fake.toasts.at(-1)).toMatchObject({
			variant: 'error',
			description: 'docker is not running'
		});
		expect(fake.dismissed()).toBe(1);
	});
});
