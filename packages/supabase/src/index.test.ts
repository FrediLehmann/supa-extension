import { describe, expect, it } from 'bun:test';

import { type SupabaseConfig, project, status } from './index';

const endpoints = (studio = 54323, mailpit = 54324) => ({
	studio: `http://127.0.0.1:${studio}`,
	mailpit: `http://127.0.0.1:${mailpit}`
});

describe('project', () => {
	it('returns the first directory with a config', async () => {
		const seen: string[] = [];
		const found = await project(
			async (directory) => {
				seen.push(directory);
				return directory === '/work/app' ? { project_id: 'app' } : undefined;
			},
			'/work/app/session',
			'/work/app'
		);
		expect(found).toEqual({ directory: '/work/app', config: { project_id: 'app' } });
		expect(seen).toEqual(['/work/app/session', '/work/app']);
	});

	it('stops checking after the first match', async () => {
		const seen: string[] = [];
		await project(
			async (directory) => {
				seen.push(directory);
				return directory === '/work/app' ? {} : undefined;
			},
			'/work/app',
			'/work/other'
		);
		expect(seen).toEqual(['/work/app']);
	});

	it('skips missing directories', async () => {
		const seen: string[] = [];
		await project(
			async (directory) => {
				seen.push(directory);
				return undefined;
			},
			undefined,
			'',
			'/work/app'
		);
		expect(seen).toEqual(['/work/app']);
	});

	it('returns undefined when no directory has a config', async () => {
		expect(await project(async () => undefined, '/work/one', '/work/two')).toBeUndefined();
	});
});

describe('status', () => {
	it('reports an unconfigured project with the default endpoints', async () => {
		let checks = 0;
		const result = await status(
			{
				config: async () => undefined,
				containers: async () => {
					checks++;
					return true;
				}
			},
			'/work/app'
		);
		expect(result).toEqual({ configured: false, running: false, ...endpoints() });
		expect(checks).toBe(0);
	});

	it('reports whether the configured project is running', async () => {
		const result = await status(
			{ config: async () => ({}), containers: async () => true },
			'/work/app'
		);
		expect(result).toEqual({ configured: true, running: true, ...endpoints() });
	});

	it('reports a stopped stack', async () => {
		const result = await status(
			{ config: async () => ({}), containers: async () => false },
			'/work/app'
		);
		expect(result).toEqual({ configured: true, running: false, ...endpoints() });
	});

	it('labels the container check with the configured project id', async () => {
		const checked: string[] = [];
		await status(
			{
				config: async () => ({ project_id: 'acme' }),
				containers: async (id) => {
					checked.push(id);
					return false;
				}
			},
			'/work/app'
		);
		expect(checked).toEqual(['acme']);
	});

	it('falls back to the directory name for the project id', async () => {
		const checked: string[] = [];
		const containers = async (id: string) => {
			checked.push(id);
			return false;
		};
		await status({ config: async () => ({}), containers }, '/work/acme/');
		await status({ config: async () => ({}), containers }, 'C:\\work\\acme');
		expect(checked).toEqual(['acme', 'acme']);
	});

	it('uses the configured studio and mailpit ports', async () => {
		const result = await status(
			{
				config: async () => ({ studio: { port: 54325 }, local_smtp: { port: 54326 } }),
				containers: async () => false
			},
			'/work/app'
		);
		expect(result).toEqual({ configured: true, running: false, ...endpoints(54325, 54326) });
	});

	it('falls back to the inbucket port for mailpit', async () => {
		const result = await status(
			{ config: async () => ({ inbucket: { port: 54327 } }), containers: async () => false },
			'/work/app'
		);
		expect(result).toEqual({ configured: true, running: false, ...endpoints(54323, 54327) });
	});

	it('ignores ports that are not numbers', async () => {
		const config = {
			studio: { port: '54325' },
			local_smtp: { port: null }
		} as unknown as SupabaseConfig;
		const result = await status(
			{ config: async () => config, containers: async () => false },
			'/work/app'
		);
		expect(result).toEqual({ configured: true, running: false, ...endpoints() });
	});
});
