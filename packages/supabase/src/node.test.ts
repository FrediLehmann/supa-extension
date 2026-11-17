import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';

import { directories, status } from './node';

/** A temporary project with the given `supabase/config.toml` content. */
const project = async (config?: string) => {
	const root = await mkdtemp(join(tmpdir(), 'supa-status-'));
	const directory = join(root, 'app');
	await mkdir(join(directory, 'supabase'), { recursive: true });
	if (config !== undefined) {
		await writeFile(join(directory, 'supabase', 'config.toml'), config);
	}
	return { root, directory };
};

describe('status', () => {
	it('reads the ports from the project config', async () => {
		const { root, directory } = await project(
			'project_id = "app"\n[studio]\nport = 54325\n[local_smtp]\nport = 54326\n'
		);
		try {
			const found = await status(directory);
			expect(found.configured).toBe(true);
			expect(found.studio).toBe('http://127.0.0.1:54325');
			expect(found.mailpit).toBe('http://127.0.0.1:54326');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('treats a malformed config as no project', async () => {
		const { root, directory } = await project('project_id = "app');
		try {
			expect((await status(directory)).configured).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('treats a missing config as no project', async () => {
		const { root, directory } = await project();
		try {
			expect((await status(directory)).configured).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('directories', () => {
	it('walks from the session directory to the git root', async () => {
		const root = await mkdtemp(join(tmpdir(), 'supa-'));
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
		const cwd = join(tmpdir(), 'supa-no-git', 'nested');
		const found = directories(cwd);
		expect(found[0]).toBe(resolve(cwd));
		expect(found.at(-1)).toBe(parse(resolve(cwd)).root);
	});

	it('does not reach into the home directory', () => {
		const cwd = join(homedir(), 'supa-no-git', 'nested');
		const found = directories(cwd);
		expect(found[0]).toBe(resolve(cwd));
		expect(found).not.toContain(resolve(homedir()));
		expect(found.at(-1)).toBe(resolve(join(homedir(), 'supa-no-git')));
	});

	it('includes the session directory when it is the home directory', () => {
		expect(directories(homedir())[0]).toBe(resolve(homedir()));
	});

	it('stops at the session directory when it is the git root', async () => {
		const root = await mkdtemp(join(tmpdir(), 'supa-'));
		try {
			await mkdir(join(root, '.git'));
			expect(directories(root)).toEqual([root]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
