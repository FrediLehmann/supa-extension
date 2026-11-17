import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';

import type { SupabaseStatus } from '@supabase-agent-extension/supabase';
import type { LifecycleResult } from '@supabase-agent-extension/supabase/host';

import { type Host, type Message, type Response, create, serve, tool } from './server';

const running: SupabaseStatus = {
	configured: true,
	running: true,
	studio: 'http://127.0.0.1:54323',
	mailpit: 'http://127.0.0.1:54324'
};

const stopped: SupabaseStatus = { ...running, running: false };

const missing: SupabaseStatus = { configured: false, running: false, studio: '', mailpit: '' };

const searched = ['/work/app/packages', '/work/app'];

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

const make = (
	options: {
		status?: SupabaseStatus | (() => Promise<SupabaseStatus>);
		start?: () => Promise<LifecycleResult>;
		stop?: () => Promise<LifecycleResult>;
	} = {}
) => {
	const calls: Array<{ method: string; directories: Array<string | undefined> }> = [];
	const opened: string[] = [];
	const saved: SupabaseStatus[] = [];
	const host: Host = {
		status: async (...directories) => {
			calls.push({ method: 'status', directories });
			const status = options.status ?? running;
			return typeof status === 'function' ? status() : status;
		},
		start: async (...directories) => {
			calls.push({ method: 'start', directories });
			return options.start ? options.start() : { ok: true, message: 'Started.' };
		},
		stop: async (...directories) => {
			calls.push({ method: 'stop', directories });
			return options.stop ? options.stop() : { ok: true, message: 'Stopped.' };
		},
		open: (url) => opened.push(url),
		saved: (status) => saved.push(status)
	};
	const handle = create(host, searched);
	let id = 0;
	const request = (method: string, params?: unknown) =>
		handle({ jsonrpc: '2.0', id: ++id, method, params });
	const call = async (args: unknown) => {
		const response = (await request('tools/call', { name: 'supabase', arguments: args })) as {
			result: { content: Array<{ text: string }>; isError?: boolean };
		};
		return { text: response.result.content[0].text, isError: response.result.isError ?? false };
	};
	return { handle, request, call, calls, opened, saved };
};

describe('protocol', () => {
	it('echoes a supported protocol version and advertises tools', async () => {
		const { request } = make();
		const response = (await request('initialize', { protocolVersion: '2025-06-18' })) as {
			result: Record<string, unknown>;
		};
		expect(response.result.protocolVersion).toBe('2025-06-18');
		expect(response.result.capabilities).toEqual({ tools: {} });
		expect(response.result.serverInfo).toEqual({ name: 'supabase', version: '0.0.0' });
	});

	it('answers an unknown protocol version with its latest', async () => {
		const { request } = make();
		const response = (await request('initialize', { protocolVersion: '1999-01-01' })) as {
			result: { protocolVersion: string };
		};
		expect(response.result.protocolVersion).toBe('2025-11-25');
	});

	it('does not answer notifications', async () => {
		const { handle } = make();
		expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
	});

	it('answers ping', async () => {
		const { request } = make();
		expect(await request('ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
	});

	it('lists the supabase tool with its actions', async () => {
		const { request } = make();
		const response = (await request('tools/list')) as { result: { tools: (typeof tool)[] } };
		expect(response.result.tools.map((listed) => listed.name)).toEqual(['supabase']);
		expect(response.result.tools[0].inputSchema.properties.action.enum).toEqual([
			'status',
			'start',
			'stop',
			'open'
		]);
	});

	it('rejects unknown methods and tools', async () => {
		const { request } = make();
		expect(((await request('resources/list')) as { error: { code: number } }).error.code).toBe(
			-32601
		);
		expect(
			((await request('tools/call', { name: 'other' })) as { error: { code: number } }).error.code
		).toBe(-32602);
	});

	it('reports an unknown action as a tool error', async () => {
		const { call, calls } = make();
		expect(await call({ action: 'restart' })).toEqual({
			text: 'action must be one of status, start, stop, open.',
			isError: true
		});
		expect(calls).toEqual([]);
	});
});

describe('tool', () => {
	it('reads the status of the searched directories and saves it', async () => {
		const { call, calls, saved } = make();
		expect(await call({ action: 'status' })).toEqual({
			text: 'The local Supabase stack is running.\nStudio: http://127.0.0.1:54323\nMailpit: http://127.0.0.1:54324',
			isError: false
		});
		expect(calls).toEqual([{ method: 'status', directories: searched }]);
		expect(saved).toEqual([running]);
	});

	it('reports a missing project', async () => {
		const { call } = make({ status: missing });
		expect((await call({ action: 'status' })).text).toBe(
			'No supabase/config.toml was found for this session.'
		);
	});

	it('treats a failed status read as no project', async () => {
		const { call, saved } = make({ status: () => Promise.reject(new Error('docker')) });
		expect((await call({ action: 'status' })).text).toContain('No supabase/config.toml');
		expect(saved[0].configured).toBe(false);
	});

	it('starts and stops the stack, then refreshes the status', async () => {
		const { call, calls } = make();
		expect(await call({ action: 'start' })).toEqual({ text: 'Started.', isError: false });
		expect(await call({ action: 'stop' })).toEqual({ text: 'Stopped.', isError: false });
		expect(calls.map((entry) => entry.method)).toEqual(['start', 'status', 'stop', 'status']);
		expect(calls[0].directories).toEqual(searched);
	});

	it('reports a failed or rejected lifecycle call as a tool error', async () => {
		const failed = make({ start: async () => ({ ok: false, message: 'Docker is not running.' }) });
		expect(await failed.call({ action: 'start' })).toEqual({
			text: 'Docker is not running.',
			isError: true
		});
		const rejected = make({ stop: () => Promise.reject(new Error('boom')) });
		expect(await rejected.call({ action: 'stop' })).toEqual({ text: 'boom', isError: true });
	});

	it('refuses a second start or stop while one is in flight', async () => {
		const gate = deferred<LifecycleResult>();
		const { call } = make({ start: () => gate.promise });
		const first = call({ action: 'start' });
		expect(await call({ action: 'stop' })).toEqual({
			text: 'Supabase is already starting or stopping.',
			isError: true
		});
		expect(await call({ action: 'open' })).toEqual({
			text: 'Supabase is already starting or stopping.',
			isError: true
		});
		gate.resolve({ ok: true, message: 'Started.' });
		expect((await first).text).toBe('Started.');
		expect((await call({ action: 'stop' })).text).toBe('Stopped.');
	});

	it('keeps the guard up until the status read after a start lands', async () => {
		const read = deferred<SupabaseStatus>();
		let reads = 0;
		const { call, calls } = make({
			status: () => (++reads === 1 ? read.promise : Promise.resolve(running))
		});
		const first = call({ action: 'start' });
		// Wait until the start finished and its follow-up status read is pending.
		while (!calls.some((entry) => entry.method === 'status')) await Promise.resolve();
		expect(await call({ action: 'stop' })).toEqual({
			text: 'Supabase is already starting or stopping.',
			isError: true
		});
		read.resolve(running);
		expect((await first).text).toBe('Started.');
		expect((await call({ action: 'stop' })).text).toBe('Stopped.');
	});

	it('marks the tool as destructive, since stop shuts the stack down', () => {
		expect(tool.annotations.destructiveHint).toBe(true);
	});

	it('opens Studio and Mailpit while the stack runs', async () => {
		const { call, opened } = make();
		expect(await call({ action: 'open' })).toEqual({
			text: 'Opened Studio and Mailpit.\nStudio: http://127.0.0.1:54323\nMailpit: http://127.0.0.1:54324',
			isError: false
		});
		expect(opened).toEqual([running.studio, running.mailpit]);
	});

	it('opens nothing while the stack is stopped or missing', async () => {
		const idle = make({ status: stopped });
		expect(await idle.call({ action: 'open' })).toEqual({
			text: 'The local Supabase stack is not running.',
			isError: true
		});
		expect(idle.opened).toEqual([]);
		const none = make({ status: missing });
		expect((await none.call({ action: 'open' })).text).toContain('No supabase/config.toml');
	});
});

describe('serve', () => {
	/** Feeds lines to the server and resolves once `expected` responses arrived, then checks no extra one follows. */
	const exchange = async (lines: string[], expected: number, handle = make().handle) => {
		const input = new PassThrough();
		const output = new PassThrough();
		const received: Response[] = [];
		const arrived = deferred<void>();
		output.on('data', (chunk: Buffer) => {
			for (const line of chunk.toString().split('\n').filter(Boolean)) {
				received.push(JSON.parse(line) as Response);
			}
			if (received.length >= expected) arrived.resolve();
		});
		serve(handle, input, output);
		for (const line of lines) input.write(`${line}\n`);
		input.end();
		if (expected > 0) await arrived.promise;
		// Let any handler that settles right after the last expected answer write, so an unexpected extra shows up.
		await new Promise((done) => setImmediate(done));
		return received;
	};

	it('answers newline-delimited requests and skips notifications and blank lines', async () => {
		const received = await exchange(
			[
				JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' } satisfies Message),
				'',
				JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' } satisfies Message)
			],
			1
		);
		expect(received).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
	});

	it('reports unparsable input', async () => {
		expect(await exchange(['{not json'], 1)).toEqual([
			{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
		]);
	});

	it('rejects JSON that is not a request object and keeps serving', async () => {
		const invalid = {
			jsonrpc: '2.0',
			id: null,
			error: { code: -32600, message: 'Invalid Request' }
		} satisfies Response;
		const received = await exchange(
			['null', '42', '[]', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })],
			4
		);
		expect(received.slice(0, 3)).toEqual([invalid, invalid, invalid]);
		expect(received[3]).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
	});

	it('reports a handler that throws as an internal error', async () => {
		const received = await exchange(
			[JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })],
			1,
			() => Promise.reject(new Error('boom'))
		);
		expect(received).toEqual([
			{ jsonrpc: '2.0', id: 7, error: { code: -32603, message: 'Error: boom' } }
		]);
	});
});
