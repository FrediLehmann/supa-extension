import { describe, expect, it } from 'bun:test';

import type { SupabaseStatus } from '@supabase-agent-extension/supabase';

import { indicator } from './shared';

const running: SupabaseStatus = {
	configured: true,
	running: true,
	studio: 'http://127.0.0.1:54323',
	mailpit: 'http://127.0.0.1:54324'
};

const stopped: SupabaseStatus = { ...running, running: false };

const fg = (color: string, text: string) => `${color}:${text}`;

describe('indicator', () => {
	it('is a green dot while the stack runs', () => {
		expect(indicator(running, fg)).toBe('success:● Supabase');
	});

	it('is a muted hollow dot while the stack is stopped', () => {
		expect(indicator(stopped, fg)).toBe('dim:○ Supabase');
	});

	it('is hidden when no project is configured', () => {
		expect(
			indicator({ configured: false, running: false, studio: '', mailpit: '' }, fg)
		).toBeUndefined();
	});
});
