import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { status } from './node';

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
