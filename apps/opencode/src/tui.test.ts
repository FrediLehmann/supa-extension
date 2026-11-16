import { describe, expect, it } from 'bun:test';

import type { Context, KeymapCommand, KeymapLayer, Route } from '@opencode/plugin/tui/context';

import type { Target } from './shared';
import tui from './tui';

type LifecycleResult = { ok: boolean; message: string };

type Toast = { title?: string; message: string; variant?: string };

type Fake = {
	ctx: Context;
	toasts: Toast[];
	slots: string[];
	disposed: number;
	layer?: () => KeymapLayer;
	calls: Array<{ method: 'start' | 'stop'; input?: Target }>;
};

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

const makeContext = (
	options: {
		route?: Route;
		location?: { directory: string };
		defaultDirectory?: string;
		sessions?: Record<string, { location: { directory: string }; projectID: string }>;
		projects?: Array<{ id: string; canonical: string }>;
		start?: (input?: Target) => Promise<LifecycleResult>;
		stop?: (input?: Target) => Promise<LifecycleResult>;
	} = {}
): Fake => {
	const fake: Fake = {
		ctx: undefined as unknown as Context,
		toasts: [],
		slots: [],
		disposed: 0,
		calls: []
	};
	const sessions = options.sessions ?? {};
	const projects = options.projects ?? [];
	const route = options.route ?? { type: 'home' };

	const rpc = {
		status: async () => ({ configured: false, running: false, studio: '', mailpit: '' }),
		start: async (input?: Target) => {
			fake.calls.push({ method: 'start', input });
			return options.start ? options.start(input) : { ok: true, message: 'Supabase started.' };
		},
		stop: async (input?: Target) => {
			fake.calls.push({ method: 'stop', input });
			return options.stop ? options.stop(input) : { ok: true, message: 'Supabase stopped.' };
		}
	};

	fake.ctx = {
		location: options.location,
		data: {
			session: { get: (id: string) => sessions[id] },
			project: {
				get: (id: string) => projects.find((project) => project.id === id),
				list: () => projects
			},
			location: {
				default: () => ({ directory: options.defaultDirectory ?? '/work/project' })
			}
		},
		client: { rpc: () => rpc },
		ui: {
			router: { current: () => route },
			toast: {
				show: (toast: Toast) => {
					fake.toasts.push(toast);
				}
			},
			slot: (claim: { append: string }) => {
				fake.slots.push(claim.append);
				return () => {
					fake.disposed++;
				};
			}
		},
		keymap: {
			layer: (factory: () => KeymapLayer) => {
				fake.layer = factory;
			}
		}
	} as unknown as Context;

	return fake;
};

const command = (fake: Fake, id: string) => {
	const found = fake.layer?.().commands?.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`command ${id} was not registered`);
	return found;
};

const enabled = (candidate: KeymapCommand) =>
	typeof candidate.enabled === 'function' ? candidate.enabled() : candidate.enabled;

describe('tui plugin', () => {
	it('appends the indicator to the home and prompt footers', () => {
		const fake = makeContext();
		const cleanup = tui.setup(fake.ctx);
		expect(fake.slots).toEqual(['home.footer.status', 'prompt.footer.status']);
		if (typeof cleanup === 'function') cleanup();
		expect(fake.disposed).toBe(2);
	});

	it('registers scoped start and stop commands', () => {
		const fake = makeContext();
		tui.setup(fake.ctx);
		const layer = fake.layer?.();
		expect(layer?.mode).toBe('global');
		expect(layer?.priority).toBe(10);
		expect(layer?.commands?.map((candidate) => candidate.id)).toEqual([
			'supabase.start',
			'supabase.stop'
		]);
		expect(command(fake, 'supabase.start')).toMatchObject({
			group: 'Supabase',
			palette: true,
			slash: { name: 'supabase-start' }
		});
		expect(command(fake, 'supabase.stop')).toMatchObject({
			group: 'Supabase',
			palette: true,
			slash: { name: 'supabase-stop' }
		});
	});

	it('starts the stack for the TUI location', async () => {
		const fake = makeContext({
			defaultDirectory: '/work/project',
			projects: [{ id: 'project', canonical: '/work/project' }]
		});
		tui.setup(fake.ctx);
		await command(fake, 'supabase.start').run?.();

		expect(fake.calls).toEqual([
			{ method: 'start', input: { directory: '/work/project', worktree: '/work/project' } }
		]);
		expect(fake.toasts.map((toast) => toast.variant)).toEqual(['info', 'success']);
		expect(fake.toasts.at(-1)?.message).toBe('Supabase started.');
		expect(enabled(command(fake, 'supabase.start'))).toBe(true);
	});

	it('targets the open session and its most specific project', async () => {
		const fake = makeContext({
			route: { type: 'session', sessionID: 'session' },
			sessions: {
				session: { location: { directory: '/work/project/src' }, projectID: 'project' }
			},
			projects: [
				{ id: 'root', canonical: '/work' },
				{ id: 'project', canonical: '/work/project' }
			]
		});
		tui.setup(fake.ctx);
		await command(fake, 'supabase.stop').run?.();

		expect(fake.calls).toEqual([
			{
				method: 'stop',
				input: { directory: '/work/project/src', worktree: '/work/project' }
			}
		]);
		expect(fake.toasts.at(-1)?.message).toBe('Supabase stopped.');
	});

	it('ignores a second command while one is running', async () => {
		const gate = deferred<LifecycleResult>();
		const fake = makeContext({ start: () => gate.promise });
		tui.setup(fake.ctx);

		const running = command(fake, 'supabase.start').run?.();
		expect(enabled(command(fake, 'supabase.start'))).toBe(false);
		expect(enabled(command(fake, 'supabase.stop'))).toBe(false);

		await command(fake, 'supabase.stop').run?.();
		expect(fake.calls).toHaveLength(1);

		gate.resolve({ ok: true, message: 'Supabase started.' });
		await running;
		expect(fake.calls).toHaveLength(1);
		expect(enabled(command(fake, 'supabase.start'))).toBe(true);
	});

	it('reports a failed start as an error toast', async () => {
		const fake = makeContext({
			start: async () => {
				throw { type: 'error', message: 'docker is not running' };
			}
		});
		tui.setup(fake.ctx);
		await command(fake, 'supabase.start').run?.();

		expect(fake.toasts.at(-1)).toMatchObject({
			title: 'Supabase',
			message: 'docker is not running',
			variant: 'error'
		});
	});
});
