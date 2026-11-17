#!/usr/bin/env node
/**
 * The plugin's one entry point, bundled into `dist/cli.js` for Node:
 *
 * - `mcp` serves the `supabase` tool over stdio;
 * - `session-start` is the SessionStart hook that tells the model the stack's state;
 * - `statusline` prints the status line indicator.
 */
import { readStatus } from '@supabase-agent-extension/supabase/host';
import { directories, open, start, status, stop } from '@supabase-agent-extension/supabase/node';

import { create, serve } from './server';
import { cache, indicator, inputDirectory, sessionContext } from './shared';

/** A status read that reports no project instead of failing, as the MCP server's reads do. */
const read = (searched: string[]) => readStatus(() => status(...searched));

/** Everything Claude Code writes to a hook or status line on stdin. */
const stdin = async () => {
	if (process.stdin.isTTY) return '';
	let input = '';
	process.stdin.setEncoding('utf8');
	for await (const chunk of process.stdin) input += chunk;
	return input;
};

/** The project the session started in: Claude Code sets it for hooks and launches the MCP server inside it. */
const projectDirectory = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();

const mcp = () => {
	const searched = directories(projectDirectory());
	const shared = cache(searched[0]);
	serve(create({ status, start, stop, open, saved: (next) => shared.write(next) }, searched));
};

const sessionStart = async () => {
	const directory = process.env.CLAUDE_PROJECT_DIR || inputDirectory(await stdin(), process.cwd());
	const searched = directories(directory);
	const current = await read(searched);
	cache(searched[0]).write(current);
	const context = sessionContext(current);
	if (!context) return;
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context }
		})
	);
};

const statusline = async () => {
	const searched = directories(inputDirectory(await stdin(), process.cwd()));
	const shared = cache(searched[0]);
	let current = shared.read();
	if (!current) {
		current = await read(searched);
		shared.write(current);
	}
	process.stdout.write(indicator(current));
};

const commands: Record<string, () => unknown> = {
	mcp,
	'session-start': sessionStart,
	statusline
};

const command = commands[process.argv[2] ?? ''];
if (!command) {
	process.stderr.write(`Usage: cli.js <${Object.keys(commands).join('|')}>\n`);
	process.exit(2);
}
await command();
