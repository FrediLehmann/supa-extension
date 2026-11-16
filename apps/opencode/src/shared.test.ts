import { describe, expect, it } from 'bun:test';

import {
	badgeTooltip,
	browserTargets,
	errorMessage,
	fetchStatus,
	lifecycleCommands,
	markPending,
	offline,
	refreshInterval,
	runLifecycle
} from './shared';

describe('errorMessage', () => {
	it('reads the message from a plain RPC error', () => {
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
	it('returns the status the RPC resolved', async () => {
		const status = { configured: true, running: true, studio: 'a', mailpit: 'b' };
		expect(await fetchStatus(async () => status)).toBe(status);
	});

	it('resolves to undefined when the RPC rejects', async () => {
		expect(
			await fetchStatus(async () => {
				throw new Error('offline');
			})
		).toBeUndefined();
	});
});

describe('runLifecycle', () => {
	it('returns the result the RPC resolved', async () => {
		const result = { ok: true, message: 'Supabase started.' };
		expect(await runLifecycle(async () => result)).toBe(result);
	});

	it('turns a rejected RPC error into a failed result', async () => {
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

describe('markPending', () => {
	it('sets an action without mutating the current map', () => {
		const current = new Map<string, 'start' | 'stop'>([['/work/a', 'start']]);
		const next = markPending(current, '/work/b', 'stop');
		expect(current).toEqual(new Map([['/work/a', 'start']]));
		expect(next).toEqual(
			new Map([
				['/work/a', 'start'],
				['/work/b', 'stop']
			])
		);
	});

	it('replaces the action for a directory', () => {
		const next = markPending(new Map([['/work/a', 'start']]), '/work/a', 'stop');
		expect(next).toEqual(new Map([['/work/a', 'stop']]));
	});

	it('clears the action when none is given', () => {
		const next = markPending(new Map([['/work/a', 'start']]), '/work/a');
		expect(next).toEqual(new Map());
	});
});

describe('badgeTooltip', () => {
	it('names the action in flight', () => {
		expect(badgeTooltip(true, 'start')).toBe('Starting…');
		expect(badgeTooltip(false, 'stop')).toBe('Stopping…');
	});

	it('describes the resting state', () => {
		expect(badgeTooltip(true)).toBe('Open Studio and Mailpit');
		expect(badgeTooltip(false)).toBe('Stopped');
	});
});

describe('browserTargets', () => {
	const status = { configured: true, running: true, studio: 'studio', mailpit: 'mailpit' };

	it('opens Studio and Mailpit while the stack runs', () => {
		expect(browserTargets(status)).toEqual(['studio', 'mailpit']);
	});

	it('opens nothing while the stack is stopped', () => {
		expect(browserTargets({ ...status, running: false })).toEqual([]);
	});

	it('opens nothing while an action is in flight', () => {
		expect(browserTargets(status, 'start')).toEqual([]);
		expect(browserTargets(status, 'stop')).toEqual([]);
	});
});

describe('constants', () => {
	it('polls every ten seconds', () => {
		expect(refreshInterval).toBe(10_000);
	});

	it('starts from an unconfigured, stopped status', () => {
		expect(offline).toEqual({ configured: false, running: false, studio: '', mailpit: '' });
	});

	it('exposes a start and a stop command', () => {
		expect(lifecycleCommands.map(({ action, slash }) => ({ action, slash }))).toEqual([
			{ action: 'start', slash: 'supabase-start' },
			{ action: 'stop', slash: 'supabase-stop' }
		]);
	});
});
