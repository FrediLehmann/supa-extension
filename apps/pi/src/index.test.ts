import { afterEach, describe, expect, it } from 'bun:test';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

import { type LifecycleResult, offline } from '../../../packages/supabase/src/host';
import type { SupabaseStatus } from '../../../packages/supabase/src/index';
import { type Host, create } from './index';
import { directories } from './shared';

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

type Command = {
	description?: string;
	handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
};

type Tool = {
	name: string;
	parameters: { properties?: { action?: { enum?: string[] } } };
	execute: (...args: unknown[]) => Promise<unknown>;
};

type Result = {
	content: Array<{ type: string; text: string }>;
	details: unknown;
	isError?: boolean;
};

type Note = { message: string; type?: string };

type Call = {
	method: 'status' | 'start' | 'stop';
	directories: Array<string | undefined>;
};

const running: SupabaseStatus = {
	configured: true,
	running: true,
	studio: 'http://127.0.0.1:54323',
	mailpit: 'http://127.0.0.1:54324'
};

const stopped: SupabaseStatus = { ...running, running: false };

const cwd = '/work/app';

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

/** Lets the polling refresh finish. */
const settle = () => new Promise((done) => setTimeout(done, 0));

const fakes: Fake[] = [];

afterEach(async () => {
	for (const fake of fakes) await fake.emit('session_shutdown');
	fakes.length = 0;
});

type Fake = {
	ctx: ExtensionContext;
	commands: Map<string, Command>;
	tools: Tool[];
	statuses: Array<[string, string | undefined]>;
	notices: Note[];
	calls: Call[];
	opened: string[];
	emit(event: string, ctx?: ExtensionContext): Promise<void>;
};

const make = (
	options: {
		status?: SupabaseStatus;
		hasUI?: boolean;
		start?: () => Promise<LifecycleResult>;
		stop?: () => Promise<LifecycleResult>;
	} = {}
): Fake => {
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, Command>();
	const tools: Tool[] = [];
	const statuses: Array<[string, string | undefined]> = [];
	const notices: Note[] = [];
	const calls: Call[] = [];
	const opened: string[] = [];

	const ctx = {
		cwd,
		hasUI: options.hasUI ?? true,
		ui: {
			theme: { fg: (color: string, text: string) => `${color}:${text}` },
			setStatus: (key: string, text: string | undefined) => statuses.push([key, text]),
			notify: (message: string, type?: string) => notices.push({ message, type })
		}
	} as unknown as ExtensionContext;

	const host: Host = {
		status: async (...directories) => {
			calls.push({ method: 'status', directories });
			return options.status ?? running;
		},
		start: async (...directories) => {
			calls.push({ method: 'start', directories });
			return options.start ? options.start() : { ok: true, message: 'Supabase started.' };
		},
		stop: async (...directories) => {
			calls.push({ method: 'stop', directories });
			return options.stop ? options.stop() : { ok: true, message: 'Supabase stopped.' };
		},
		open: (url) => opened.push(url)
	};

	const pi = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand: (name: string, command: Command) => {
			commands.set(name, command);
		},
		registerTool: (tool: Tool) => {
			tools.push(tool);
		}
	};

	create(host)(pi as unknown as ExtensionAPI);

	const fake: Fake = {
		ctx,
		commands,
		tools,
		statuses,
		notices,
		calls,
		opened,
		emit: async (event, context = ctx) => {
			for (const handler of handlers.get(event) ?? []) await handler({}, context);
		}
	};
	fakes.push(fake);
	return fake;
};

const command = (fake: Fake, name: string) => {
	const found = fake.commands.get(name);
	if (!found) throw new Error(`The ${name} command is not registered.`);
	return found;
};

const tool = (fake: Fake) => {
	const found = fake.tools.find((entry) => entry.name === 'supabase');
	if (!found) throw new Error('The supabase tool is not registered.');
	return found;
};

const call = async (fake: Fake, action: string) =>
	(await tool(fake).execute('call', { action }, undefined, undefined, fake.ctx)) as Result;

describe('create', () => {
	it('registers the start, stop, and open commands', () => {
		const fake = make();
		expect([...fake.commands.keys()].sort()).toEqual([
			'supabase-open',
			'supabase-start',
			'supabase-stop'
		]);
	});

	it('registers the supabase tool with its actions', () => {
		const fake = make();
		expect(tool(fake).parameters.properties?.action?.enum).toEqual([
			'status',
			'start',
			'stop',
			'open'
		]);
	});
});

describe('footer indicator', () => {
	it('shows a green dot while the stack runs', async () => {
		const fake = make({ status: running });
		await fake.emit('session_start');
		await settle();
		expect(fake.statuses.at(-1)).toEqual(['supabase', 'success:● Supabase']);
	});

	it('shows a hollow dot while the stack is stopped', async () => {
		const fake = make({ status: stopped });
		await fake.emit('session_start');
		await settle();
		expect(fake.statuses.at(-1)).toEqual(['supabase', 'dim:○ Supabase']);
	});

	it('hides the indicator when no project is configured', async () => {
		const fake = make({ status: offline });
		await fake.emit('session_start');
		await settle();
		expect(fake.statuses.at(-1)).toEqual(['supabase', undefined]);
	});

	it('does not poll when there is no footer to update', async () => {
		const fake = make({ hasUI: false });
		await fake.emit('session_start');
		await settle();
		expect(fake.statuses).toEqual([]);
		expect(fake.calls).toEqual([]);
	});
});

describe('lifecycle commands', () => {
	it('starts the stack in the session project', async () => {
		const fake = make();
		await command(fake, 'supabase-start').handler('', fake.ctx);
		expect(fake.calls[0]).toEqual({ method: 'start', directories: directories(cwd) });
		expect(fake.notices.at(-1)).toEqual({ message: 'Supabase started.', type: 'info' });
	});

	it('stops the stack in the session project', async () => {
		const fake = make();
		await command(fake, 'supabase-stop').handler('', fake.ctx);
		expect(fake.calls[0]?.method).toBe('stop');
		expect(fake.notices.at(-1)).toEqual({ message: 'Supabase stopped.', type: 'info' });
	});

	it('reports a failed start', async () => {
		const fake = make({ start: async () => ({ ok: false, message: 'Docker is not running.' }) });
		await command(fake, 'supabase-start').handler('', fake.ctx);
		expect(fake.notices.at(-1)).toEqual({ message: 'Docker is not running.', type: 'error' });
	});

	it('ignores a second start while one is in flight', async () => {
		const started = deferred<LifecycleResult>();
		const fake = make({ start: () => started.promise });
		const handler = command(fake, 'supabase-start').handler;

		const first = handler('', fake.ctx);
		await handler('', fake.ctx);

		expect(fake.notices.at(-1)).toEqual({
			message: 'Supabase is already starting or stopping.',
			type: 'warning'
		});
		expect(fake.calls.filter((entry) => entry.method === 'start')).toHaveLength(1);

		started.resolve({ ok: true, message: 'Supabase started.' });
		await first;
	});

	it('refreshes the indicator after a start', async () => {
		const fake = make({ status: running });
		await command(fake, 'supabase-start').handler('', fake.ctx);
		await settle();
		expect(fake.statuses.at(-1)).toEqual(['supabase', 'success:● Supabase']);
	});
});

describe('open command', () => {
	it('opens Studio and Mailpit while the stack runs', async () => {
		const fake = make({ status: running });
		await command(fake, 'supabase-open').handler('', fake.ctx);
		expect(fake.opened).toEqual([running.studio, running.mailpit]);
		expect(fake.notices.at(-1)).toEqual({
			message: 'Opened Supabase Studio and Mailpit.',
			type: 'info'
		});
	});

	it('warns instead of opening a stopped stack', async () => {
		const fake = make({ status: stopped });
		await command(fake, 'supabase-open').handler('', fake.ctx);
		expect(fake.opened).toEqual([]);
		expect(fake.notices.at(-1)?.type).toBe('warning');
	});
});

describe('supabase tool', () => {
	it('reports the status', async () => {
		const fake = make({ status: running });
		const result = await call(fake, 'status');
		expect(result.content[0]?.text).toContain('Studio: http://127.0.0.1:54323');
		expect(result.isError).toBeUndefined();
	});

	it('starts the stack', async () => {
		const fake = make();
		const result = await call(fake, 'start');
		expect(fake.calls[0]?.method).toBe('start');
		expect(result.content[0]?.text).toBe('Supabase started.');
		expect(result.isError).toBe(false);
	});

	it('marks a failed stop as an error', async () => {
		const fake = make({ stop: async () => ({ ok: false, message: 'Docker is not running.' }) });
		const result = await call(fake, 'stop');
		expect(result.content[0]?.text).toBe('Docker is not running.');
		expect(result.isError).toBe(true);
	});

	it('opens Studio and Mailpit', async () => {
		const fake = make({ status: running });
		const result = await call(fake, 'open');
		expect(fake.opened).toEqual([running.studio, running.mailpit]);
		expect(result.content[0]?.text).toContain('Mailpit: http://127.0.0.1:54324');
	});

	it('reports a stopped stack instead of opening it', async () => {
		const fake = make({ status: stopped });
		const result = await call(fake, 'open');
		expect(fake.opened).toEqual([]);
		expect(result.isError).toBe(true);
	});
});
