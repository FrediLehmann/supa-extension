import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SupabaseStatus } from '@supabase-agent-extension/supabase';
import { refreshInterval } from '@supabase-agent-extension/supabase/host';

import { cache, indicator, inputDirectory, sessionContext } from './shared';

const running: SupabaseStatus = {
	configured: true,
	running: true,
	studio: 'http://127.0.0.1:54323',
	mailpit: 'http://127.0.0.1:54324'
};

const stopped: SupabaseStatus = { ...running, running: false };

const missing: SupabaseStatus = { configured: false, running: false, studio: '', mailpit: '' };

describe('indicator', () => {
	it('is a green dot while the stack runs', () => {
		expect(indicator(running)).toBe('\x1b[32m● Supabase\x1b[0m');
	});

	it('is a dim hollow dot while the stack is stopped', () => {
		expect(indicator(stopped)).toBe('\x1b[2m○ Supabase\x1b[0m');
	});

	it('is empty when no project is configured', () => {
		expect(indicator(missing)).toBe('');
	});
});

describe('sessionContext', () => {
	it('reports the status and points at the tool', () => {
		const context = sessionContext(stopped);
		expect(context).toContain('The local Supabase stack is stopped.');
		expect(context).toContain('Studio: http://127.0.0.1:54323');
		expect(context).toContain('supabase tool');
	});

	it('adds nothing without a project', () => {
		expect(sessionContext(missing)).toBeUndefined();
	});
});

describe('inputDirectory', () => {
	it('prefers the status line project directory', () => {
		expect(
			inputDirectory(
				JSON.stringify({ cwd: '/c', workspace: { project_dir: '/p', current_dir: '/d' } }),
				'/f'
			)
		).toBe('/p');
	});

	it('falls back to the current directory and then the hook cwd', () => {
		expect(
			inputDirectory(JSON.stringify({ cwd: '/c', workspace: { current_dir: '/d' } }), '/f')
		).toBe('/d');
		expect(inputDirectory(JSON.stringify({ cwd: '/c' }), '/f')).toBe('/c');
	});

	it('falls back to the process directory without usable input', () => {
		expect(inputDirectory('', '/f')).toBe('/f');
		expect(inputDirectory('{"cwd": 3}', '/f')).toBe('/f');
	});
});

describe('cache', () => {
	const withRoot = async (run: (root: string) => Promise<void> | void) => {
		const root = await mkdtemp(join(tmpdir(), 'supa-claude-'));
		try {
			await run(root);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	};

	it('returns a status written within the polling interval', () =>
		withRoot((root) => {
			const shared = cache('/work/app', root);
			shared.write(running, 1000);
			expect(shared.read(1000 + refreshInterval - 1)).toEqual(running);
		}));

	it('expires after the polling interval', () =>
		withRoot((root) => {
			const shared = cache('/work/app', root);
			shared.write(running, 1000);
			expect(shared.read(1000 + refreshInterval)).toBeUndefined();
		}));

	it('keeps projects apart', () =>
		withRoot((root) => {
			cache('/work/app', root).write(running);
			expect(cache('/work/other', root).read()).toBeUndefined();
		}));

	it('treats a missing or corrupt entry as a miss', () =>
		withRoot(async (root) => {
			const shared = cache('/work/app', root);
			expect(shared.read()).toBeUndefined();
			await writeFile(shared.file, '{');
			expect(shared.read()).toBeUndefined();
		}));

	it('ignores a write it cannot make', () => {
		expect(() => cache('/work/app', '/dev/null/nowhere').write(running)).not.toThrow();
	});
});
