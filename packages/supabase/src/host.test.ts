import { describe, expect, it } from 'bun:test';

import {
	type Host,
	type LifecycleResult,
	browserTargets,
	busyMessage,
	createActions,
	errorMessage,
	fetchStatus,
	isAction,
	lifecycleCommands,
	offline,
	openCommand,
	readStatus,
	refreshInterval,
	runLifecycle,
	statusReport,
	stoppedMessage,
	toolParameters
} from './host';
import type { SupabaseStatus } from './index';

const running = {
	configured: true,
	running: true,
	studio: 'http://127.0.0.1:54323',
	mailpit: 'http://127.0.0.1:54324'
};

const stopped = { ...running, running: false };

describe('errorMessage', () => {
	it('reads the message from a plain error object', () => {
		expect(errorMessage({ type: 'error', message: 'the stack failed' })).toBe('the stack failed');
	});

	it('reads the message from an Error', () => {
		expect(errorMessage(new Error('boom'))).toBe('boom');
	});

	it('stringifies values that are not errors', () => {
		expect(errorMessage('plain text')).toBe('plain text');
		expect(errorMessage(42)).toBe('42');
		expect(errorMessage(null)).toBe('null');
	});

	it('ignores objects without a string message', () => {
		expect(errorMessage({ message: 42 })).toBe('[object Object]');
	});
});

describe('fetchStatus', () => {
	it('returns the status the call resolved', async () => {
		expect(await fetchStatus(async () => running)).toBe(running);
	});

	it('resolves to undefined when the call rejects', async () => {
		expect(
			await fetchStatus(async () => {
				throw new Error('offline');
			})
		).toBeUndefined();
	});
});

describe('readStatus', () => {
	it('returns the status the call resolved', async () => {
		expect(await readStatus(async () => running)).toBe(running);
	});

	it('falls back to the offline status when the call rejects', async () => {
		expect(
			await readStatus(async () => {
				throw new Error('offline');
			})
		).toBe(offline);
	});
});

describe('runLifecycle', () => {
	it('returns the result the call resolved', async () => {
		const result = { ok: true, message: 'Supabase started.' };
		expect(await runLifecycle(async () => result)).toBe(result);
	});

	it('turns a rejected error object into a failed result', async () => {
		const result = await runLifecycle(async () => {
			throw { type: 'error', message: 'the stack failed' };
		});
		expect(result).toEqual({ ok: false, message: 'the stack failed' });
	});

	it('turns a rejected Error into a failed result', async () => {
		const result = await runLifecycle(async () => {
			throw new Error('offline');
		});
		expect(result).toEqual({ ok: false, message: 'offline' });
	});

	it('stringifies a rejection that is not an error', async () => {
		const result = await runLifecycle(async () => {
			throw 'nope';
		});
		expect(result).toEqual({ ok: false, message: 'nope' });
	});
});

describe('browserTargets', () => {
	it('opens Studio and Mailpit while the stack runs', () => {
		expect(browserTargets(running)).toEqual([running.studio, running.mailpit]);
	});

	it('opens nothing while the stack is stopped', () => {
		expect(browserTargets({ ...running, running: false })).toEqual([]);
	});

	it('opens nothing while an action is in flight', () => {
		expect(browserTargets(running, true)).toEqual([]);
	});
});

describe('constants', () => {
	it('polls every ten seconds', () => {
		expect(refreshInterval).toBe(10_000);
	});

	it('starts from an unconfigured, stopped status', () => {
		expect(offline).toEqual({ configured: false, running: false, studio: '', mailpit: '' });
	});
});

describe('statusReport', () => {
	it('reports a missing project', () => {
		expect(statusReport({ configured: false, running: false, studio: '', mailpit: '' })).toBe(
			'No supabase/config.toml was found for this session.'
		);
	});

	it('reports a running stack with its URLs', () => {
		expect(statusReport(running)).toBe(
			'The local Supabase stack is running.\nStudio: http://127.0.0.1:54323\nMailpit: http://127.0.0.1:54324'
		);
	});

	it('reports a stopped stack', () => {
		expect(statusReport(stopped)).toContain('The local Supabase stack is stopped.');
	});
});

describe('openCommand', () => {
	it('uses open on macOS', () => {
		expect(openCommand('darwin', 'http://studio')).toEqual({
			command: 'open',
			args: ['http://studio']
		});
	});

	it('uses explorer on Windows', () => {
		expect(openCommand('win32', 'http://studio')).toEqual({
			command: 'explorer',
			args: ['http://studio']
		});
	});

	it('uses xdg-open on Linux', () => {
		expect(openCommand('linux', 'http://studio')).toEqual({
			command: 'xdg-open',
			args: ['http://studio']
		});
	});
});

describe('isAction', () => {
	it('accepts the actions the tool exposes', () => {
		for (const action of ['status', 'start', 'stop', 'open']) expect(isAction(action)).toBe(true);
	});

	it('rejects anything else', () => {
		expect(isAction('restart')).toBe(false);
		expect(isAction(undefined)).toBe(false);
		expect(isAction(42)).toBe(false);
	});
});

describe('lifecycleCommands', () => {
	it('exposes a start and a stop command', () => {
		expect(lifecycleCommands.map(({ action, slash }) => ({ action, slash }))).toEqual([
			{ action: 'start', slash: 'supabase-start' },
			{ action: 'stop', slash: 'supabase-stop' }
		]);
	});
});

describe('toolParameters', () => {
	it('requires one of the actions', () => {
		expect(toolParameters.properties.action.enum).toEqual(['status', 'start', 'stop', 'open']);
		expect(toolParameters.required).toEqual(['action']);
	});
});

describe('createActions', () => {
	const make = (overrides: Partial<Host> = {}, status: SupabaseStatus = running) => {
		const calls: string[] = [];
		const opened: string[] = [];
		const saved: SupabaseStatus[] = [];
		const host: Host = {
			status: async (...directories) => {
				calls.push(`status ${directories.join(',')}`);
				return status;
			},
			start: async () => ({ ok: true, message: 'started' }),
			stop: async () => ({ ok: true, message: 'stopped' }),
			open: (url) => opened.push(url),
			...overrides
		};
		const scope = {
			directories: ['/work/app', '/work'],
			saved: (next: SupabaseStatus) => saved.push(next)
		};
		return { actions: createActions(host), scope, calls, opened, saved };
	};

	it('reports the status and hands it to the scope', async () => {
		const { actions, scope, calls, saved } = make();
		expect(await actions.run('status', scope)).toEqual({
			ok: true,
			message: statusReport(running)
		});
		expect(calls).toEqual(['status /work/app,/work']);
		expect(saved).toEqual([running]);
	});

	it('refreshes the status after a start', async () => {
		const { actions, scope, saved } = make();
		expect(await actions.run('start', scope)).toEqual({ ok: true, message: 'started' });
		expect(saved).toEqual([running]);
	});

	it('turns a rejected stop into a failed result', async () => {
		const { actions, scope } = make({
			stop: async () => Promise.reject(new Error('Docker is down'))
		});
		expect(await actions.run('stop', scope)).toEqual({ ok: false, message: 'Docker is down' });
	});

	it('refuses a start, stop, or open while one is in flight, but still reads the status', async () => {
		let finish: (result: LifecycleResult) => void = () => {};
		const { actions, scope, opened } = make({
			start: () => new Promise((resolve) => (finish = resolve))
		});
		const first = actions.run('start', scope);
		expect(await actions.run('stop', scope)).toEqual({ ok: false, message: busyMessage });
		expect(await actions.run('open', scope)).toEqual({ ok: false, message: busyMessage });
		expect((await actions.run('status', scope)).ok).toBe(true);
		expect(opened).toEqual([]);
		finish({ ok: true, message: 'started' });
		expect(await first).toEqual({ ok: true, message: 'started' });
		expect((await actions.run('stop', scope)).ok).toBe(true);
	});

	it('opens Studio and Mailpit while the stack runs', async () => {
		const { actions, scope, opened } = make();
		expect((await actions.run('open', scope)).ok).toBe(true);
		expect(opened).toEqual([running.studio, running.mailpit]);
	});

	it('reports a stopped stack or a missing project instead of opening', async () => {
		expect(await make({}, stopped).actions.run('open', make().scope)).toEqual({
			ok: false,
			message: stoppedMessage
		});
		expect(await make({}, offline).actions.run('open', make().scope)).toEqual({
			ok: false,
			message: statusReport(offline)
		});
	});
});
