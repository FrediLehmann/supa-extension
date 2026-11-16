import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';

import type { SupabaseStatus } from '../../../packages/supabase/src/index';
import {
	directories,
	indicator,
	isAction,
	lifecycleCommands,
	openCommand,
	statusReport
} from './shared';

const running: SupabaseStatus = {
	configured: true,
	running: true,
	studio: 'http://127.0.0.1:54323',
	mailpit: 'http://127.0.0.1:54324'
};

const stopped: SupabaseStatus = { ...running, running: false };

const fg = (color: string, text: string) => `${color}:${text}`;

describe('directories', () => {
	it('walks from the session directory to the git root', async () => {
		const root = await mkdtemp(join(tmpdir(), 'supa-pi-'));
		try {
			const project = join(root, 'project');
			const nested = join(project, 'packages', 'app');
			await mkdir(join(project, '.git'), { recursive: true });
			await mkdir(nested, { recursive: true });

			expect(directories(nested)).toEqual([nested, join(project, 'packages'), project]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('ends at the filesystem root outside the home directory', () => {
		const cwd = join(tmpdir(), 'supa-pi-no-git', 'nested');
		const found = directories(cwd);
		expect(found[0]).toBe(resolve(cwd));
		expect(found.at(-1)).toBe(parse(resolve(cwd)).root);
	});

	it('does not reach into the home directory', () => {
		const cwd = join(homedir(), 'supa-pi-no-git', 'nested');
		const found = directories(cwd);
		expect(found[0]).toBe(resolve(cwd));
		expect(found).not.toContain(resolve(homedir()));
		expect(found.at(-1)).toBe(resolve(join(homedir(), 'supa-pi-no-git')));
	});

	it('includes the session directory when it is the home directory', () => {
		expect(directories(homedir())[0]).toBe(resolve(homedir()));
	});

	it('stops at the session directory when it is the git root', async () => {
		const root = await mkdtemp(join(tmpdir(), 'supa-pi-'));
		try {
			await mkdir(join(root, '.git'));
			expect(directories(root)).toEqual([root]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

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
	it('registers the start and stop commands', () => {
		expect(lifecycleCommands.map((command) => command.name)).toEqual([
			'supabase-start',
			'supabase-stop'
		]);
	});
});
