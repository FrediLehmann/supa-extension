import { describe, expect, it } from 'bun:test';

import {
	browserTargets,
	errorMessage,
	fetchStatus,
	offline,
	refreshInterval,
	runLifecycle
} from './host';

const running = {
	configured: true,
	running: true,
	studio: 'http://127.0.0.1:54323',
	mailpit: 'http://127.0.0.1:54324'
};

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
