import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { parse } from './toml';

const malformed = (text: string) => () => parse(text);

describe('parse', () => {
	it('reads top-level keys and tables', () => {
		const config = parse(`
			project_id = "app"

			[studio]
			port = 54323
		`);
		expect(config).toEqual({ project_id: 'app', studio: { port: 54323 } });
	});

	it('ignores comments, including a # inside a quoted string', () => {
		const config = parse(`
			# project_id = "commented"
			project_id = "a#b" # trailing comment
		`);
		expect(config).toEqual({ project_id: 'a#b' });
	});

	it('reads the config the local project ships', async () => {
		const text = await readFile(new URL('../../../supabase/config.toml', import.meta.url), 'utf8');
		const config = parse(text) as {
			project_id?: unknown;
			studio?: { port?: unknown };
			local_smtp?: { port?: unknown };
		};
		expect(config.project_id).toBe('supabase-agent-extension');
		expect(config.studio?.port).toBe(54323);
		expect(config.local_smtp?.port).toBe(54324);
	});

	it('reads dotted and quoted keys into nested tables', () => {
		const config = parse(`
			studio.port = 1
			"local_smtp".port = 2
			["inbucket"]
			port = 3
		`);
		expect(config).toEqual({
			studio: { port: 1 },
			local_smtp: { port: 2 },
			inbucket: { port: 3 }
		});
	});

	it('reads strings, numbers, and booleans', () => {
		const config = parse(`
			text = 'literal # not a comment'
			escaped = "line\\nbreak \\"quoted\\""
			integer = -17
			float = 1.5e2
			enabled = true
			disabled = false
			date = 2024-01-01
		`);
		expect(config).toEqual({
			text: 'literal # not a comment',
			escaped: 'line\nbreak "quoted"',
			integer: -17,
			float: 150,
			enabled: true,
			disabled: false
		});
	});

	it('skips arrays so their lines are not read as keys', () => {
		const config = parse(`
			schemas = ["public", "graphql_public"]
			multi = [
				"a",
				"b"
			]
			[studio]
			port = 54323
		`);
		expect(config).toEqual({ studio: { port: 54323 } });
	});

	it('skips inline tables and multi-line strings', () => {
		const config = parse(`
			inline = { port = 1 }
			text = """
			project_id = "not a key"
			"""
			literal = '''
			port = 2
			'''
			project_id = "app"
		`);
		expect(config).toEqual({ project_id: 'app' });
	});

	it('keeps a multi-line string that closes on its first line', () => {
		expect(parse('text = """a"""\nproject_id = "app"')).toEqual({
			text: 'a',
			project_id: 'app'
		});
	});

	it('does not treat a # inside a multi-line string as a comment', () => {
		const config = parse(`
			project_id = "app"
			subject = """
			Welcome # friend"""
			[studio]
			port = 54325
		`);
		expect(config).toEqual({ project_id: 'app', studio: { port: 54325 } });
	});

	it('keeps a # inside a one-line multi-line string', () => {
		expect(parse('text = """a # b"""')).toEqual({ text: 'a # b' });
	});

	it('does not let an unbalanced quote inside a comment open a string', () => {
		const config = parse(`
			# don't read the next line as a string
			project_id = "app"
			# a stray " quote stays in this comment
			[studio]
			port = 54323
		`);
		expect(config).toEqual({ project_id: 'app', studio: { port: 54323 } });
	});

	it('does not let a quote inside a multi-line string end it early', () => {
		expect(parse('text = """a " # b"""')).toEqual({ text: 'a " # b' });
	});

	it('decodes a \\U escape before a \\u escape', () => {
		expect(parse('icon = "\\U0001F600"')).toEqual({ icon: '😀' });
		expect(parse('accent = "\\u00e9"')).toEqual({ accent: 'é' });
	});

	it('returns an empty document for empty or keyless text', () => {
		expect(parse('')).toEqual({});
		expect(parse('# only a comment\n[studio]\n')).toEqual({ studio: {} });
	});
});

describe('parse failures', () => {
	it('rejects an unterminated string', () => {
		expect(malformed('project_id = "app')).toThrow('Invalid TOML at line 1.');
	});

	it('rejects a key without a value', () => {
		expect(malformed('project_id =')).toThrow();
	});

	it('rejects a line that is neither a table nor a key', () => {
		expect(malformed('[studio]\nnot a key')).toThrow();
	});

	it('rejects an unterminated multi-line string', () => {
		expect(malformed('text = """\nnever closed')).toThrow();
	});

	it('rejects an unterminated array', () => {
		expect(malformed('schemas = [\n"public"')).toThrow();
	});

	it('reports the line that failed', () => {
		expect(malformed('project_id = "app"\nport = ')).toThrow('Invalid TOML at line 2.');
	});
});
