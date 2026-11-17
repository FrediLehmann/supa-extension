/**
 * A minimal MCP server over stdio that exposes the `supabase` tool to Claude Code.
 *
 * It speaks the subset of the protocol a tools-only server needs (`initialize`, `ping`, `tools/list`, `tools/call`)
 * by hand, so the plugin runs straight from the checkout on Node with no dependencies to install.
 */
import { createInterface } from 'node:readline';

import type { SupabaseStatus } from '@supabase-agent-extension/supabase';
import {
	type Action,
	type Host as SupabaseHost,
	actions,
	createActions,
	isAction,
	toolDescription,
	toolParameters
} from '@supabase-agent-extension/supabase/host';

/** The Supabase work the server performs. Swapped out in tests. */
export type Host = SupabaseHost & {
	/** Called with every status the server reads, so the status line can show it without its own CLI calls. */
	saved?(status: SupabaseStatus): void;
};

type Id = string | number | null;

/** A JSON-RPC request or notification. Notifications have no id. */
export type Message = { jsonrpc: '2.0'; id?: Id; method?: string; params?: unknown };

export type Response =
	| { jsonrpc: '2.0'; id: Id; result: unknown }
	| { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } };

/** What a tool call returns to the model. */
export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** The protocol revisions the server answers with; the client's own is echoed back when it is one of them. */
export const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export const serverInfo = { name: 'supabase', version: '0.0.0' };

/** Shown to the model once per session, alongside the tool list. */
export const instructions =
	'Use the supabase tool when the user asks whether the local Supabase stack is running, where Studio and Mailpit are served, or wants the stack started, stopped, or opened in the browser.';

export const tool = {
	name: 'supabase',
	title: 'Supabase',
	description: toolDescription,
	inputSchema: toolParameters,
	// `stop` shuts the running containers down, so clients should not treat the tool as harmless.
	annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
};

const text = (message: string, isError = false): ToolResult => ({
	content: [{ type: 'text', text: message }],
	...(isError ? { isError: true } : {})
});

/** Builds the request handler around the Supabase actions it needs and the directories it searches. */
export const create = (host: Host, directories: string[]) => {
	const run = createActions(host).run;
	// Every status read also lands in the status line's cache, so a start or stop shows up there right away.
	const scope = { directories, saved: (status: SupabaseStatus) => host.saved?.(status) };

	const call = async (action: Action): Promise<ToolResult> => {
		const result = await run(action, scope);
		return text(result.message, !result.ok);
	};

	/** Answers one message, or returns undefined for a notification. */
	return async (message: Message): Promise<Response | undefined> => {
		if (message.id === undefined) return undefined;
		const id = message.id;
		const result = (value: unknown): Response => ({ jsonrpc: '2.0', id, result: value });
		const error = (code: number, text: string): Response => ({
			jsonrpc: '2.0',
			id,
			error: { code, message: text }
		});
		const params = (message.params ?? {}) as Record<string, unknown>;

		switch (message.method) {
			case 'initialize': {
				const requested = params.protocolVersion;
				return result({
					protocolVersion:
						typeof requested === 'string' && protocolVersions.includes(requested)
							? requested
							: protocolVersions[0],
					capabilities: { tools: {} },
					serverInfo,
					instructions
				});
			}
			case 'ping':
				return result({});
			case 'tools/list':
				return result({ tools: [tool] });
			case 'tools/call': {
				if (params.name !== tool.name) return error(-32602, `Unknown tool: ${String(params.name)}`);
				const action = (params.arguments as { action?: unknown } | undefined)?.action;
				if (!isAction(action)) {
					return result(text(`action must be one of ${actions.join(', ')}.`, true));
				}
				return result(await call(action));
			}
			default:
				return error(-32601, `Method not found: ${String(message.method)}`);
		}
	};
};

/** Reads newline-delimited JSON-RPC from stdin and writes the answers to stdout. */
export const serve = (
	handle: ReturnType<typeof create>,
	input: NodeJS.ReadableStream = process.stdin,
	output: NodeJS.WritableStream = process.stdout
) => {
	const write = (response: Response) => output.write(`${JSON.stringify(response)}\n`);
	const lines = createInterface({ input, crlfDelay: Infinity });
	lines.on('line', (line) => {
		if (!line.trim()) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
			return;
		}
		// Valid JSON that is not a single request object (`null`, a number, a batch array) is not a message.
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
			return;
		}
		const message = parsed as Message;
		// Requests are answered as they finish, so a status read is not stuck behind a minutes-long start.
		void handle(message).then(
			(response) => response && write(response),
			(failure: unknown) =>
				message.id !== undefined &&
				write({
					jsonrpc: '2.0',
					id: message.id,
					error: { code: -32603, message: String(failure) }
				})
		);
	});
	return lines;
};
