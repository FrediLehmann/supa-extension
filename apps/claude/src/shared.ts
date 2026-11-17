import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SupabaseStatus } from '@supabase-agent-extension/supabase';
import {
	indicatorLabel,
	refreshInterval,
	statusReport
} from '@supabase-agent-extension/supabase/host';

/**
 * The status line text: a green dot while running, a dim hollow dot while stopped, and nothing when the session has
 * no Supabase project. Claude Code renders the ANSI colors.
 */
export const indicator = (status: SupabaseStatus) => {
	if (!status.configured) return '';
	const color = status.running ? '32' : '2';
	return `\x1b[${color}m${indicatorLabel(status.running)}\x1b[0m`;
};

/** The context a SessionStart hook adds, so the model knows the stack's state from the first turn. */
export const sessionContext = (status: SupabaseStatus) => {
	if (!status.configured) return undefined;
	return `${statusReport(status)}\nUse the supabase tool to read the status again or to start, stop, or open the stack.`;
};

/**
 * The directory Claude Code reports to a hook or status line on stdin: the project directory the session started in,
 * the same one the MCP server runs in, so both share a cache entry.
 */
export const inputDirectory = (input: string, fallback: string) => {
	try {
		const parsed = JSON.parse(input) as {
			cwd?: unknown;
			workspace?: { project_dir?: unknown; current_dir?: unknown };
		};
		for (const candidate of [
			parsed.workspace?.project_dir,
			parsed.workspace?.current_dir,
			parsed.cwd
		]) {
			if (typeof candidate === 'string' && candidate) return candidate;
		}
	} catch {
		// No or malformed input: fall back to the process directory.
	}
	return fallback;
};

type Cached = { at: number; status: SupabaseStatus };

/**
 * A status shared between the MCP server and the status line through a temp file, so the status line, which Claude
 * Code redraws often, runs `docker ps` at most once per polling interval, and shows a start or stop right away.
 */
export const cache = (directory: string, root = join(tmpdir(), 'claude-supabase')) => {
	const file = join(root, `${createHash('sha1').update(directory).digest('hex')}.json`);
	return {
		file,
		read(now = Date.now()): SupabaseStatus | undefined {
			try {
				const cached = JSON.parse(readFileSync(file, 'utf8')) as Cached;
				return now - cached.at < refreshInterval ? cached.status : undefined;
			} catch {
				return undefined;
			}
		},
		write(status: SupabaseStatus, now = Date.now()) {
			try {
				mkdirSync(root, { recursive: true });
				// Write then rename, so a status line drawn mid-write never reads half a file.
				const temporary = `${file}.${process.pid}`;
				writeFileSync(temporary, JSON.stringify({ at: now, status } satisfies Cached));
				renameSync(temporary, file);
			} catch {
				// The cache only saves CLI calls; a failed write is not worth surfacing.
			}
		}
	};
};
