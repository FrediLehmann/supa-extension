import { describe, expect, it } from 'bun:test';

import { badgeTooltip, lifecycleCommands, markPending } from './shared';

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

describe('lifecycleCommands', () => {
	it('exposes a start and a stop command', () => {
		expect(lifecycleCommands.map(({ action, slash }) => ({ action, slash }))).toEqual([
			{ action: 'start', slash: 'supabase-start' },
			{ action: 'stop', slash: 'supabase-stop' }
		]);
	});
});
