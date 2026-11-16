/**
 * Reads the keys the local stack status needs from `supabase/config.toml`. Bun's TOML parser only exists in Bun, and
 * the extensions also run in Node, so one small reader keeps the behavior the same in every host.
 *
 * It handles tables, dotted and quoted keys, comments, and the scalar values a Supabase config uses. Arrays, inline
 * tables, and multi-line strings are skipped: the status reads `project_id` and the service ports, nothing else.
 * A malformed document throws, so a host can report the project as not configured instead of guessing.
 */

/** A scalar value the reader understands. */
export type Scalar = string | number | boolean;

/** A parsed TOML document: the tables and values the reader understood. */
export interface Toml {
	[key: string]: Toml | Scalar;
}

/** Whether a parsed value is a table the reader can descend into. */
const isTable = (value: Toml | Scalar | undefined): value is Toml => {
	// A table is the only parsed value that holds other values; arrays are skipped before they get here.
	if (value === undefined || Array.isArray(value)) return false;
	return typeof value === 'object';
};

/** The document without its comments. A `#` inside a single- or multi-line string does not start one. */
const stripComments = (text: string) => {
	let stripped = '';
	let index = 0;
	// The delimiter that closes the string we are inside, or undefined outside a string.
	let close: string | undefined;
	while (index < text.length) {
		const character = text[index] as string;
		if (!close) {
			if (character === '#') {
				const end = text.indexOf('\n', index);
				index = end < 0 ? text.length : end;
				continue;
			}
			if (character === '"' || character === "'") {
				close = text.startsWith(character.repeat(3), index) ? character.repeat(3) : character;
				stripped += close;
				index += close.length;
				continue;
			}
			stripped += character;
			index++;
			continue;
		}
		// Basic strings escape the next character, so an escaped quote does not close them.
		if (character === '\\' && (close === '"' || close === '"""')) {
			stripped += text.slice(index, index + 2);
			index += 2;
			continue;
		}
		if (text.startsWith(close, index)) {
			stripped += close;
			index += close.length;
			close = undefined;
			continue;
		}
		stripped += character;
		index++;
	}
	return stripped;
};

/** The key and value of `key = value`, split at the first `=` outside a quoted key. */
const assignment = (line: string) => {
	let quote: string | undefined;
	let escaped = false;
	for (let index = 0; index < line.length; index++) {
		const character = line[index] as string;
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quote) {
			if (character === '\\' && quote === '"') escaped = true;
			else if (character === quote) quote = undefined;
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === '=') {
			return { key: line.slice(0, index), value: line.slice(index + 1).trim() };
		}
	}
	return undefined;
};

/** A key or string with its surrounding quotes removed. */
const unquote = (text: string) => {
	const trimmed = text.trim();
	const quote = trimmed[0];
	if (trimmed.length > 1 && (quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
};

/** Splits a dotted key path, honoring quoted parts such as `"a.b".c`. */
const path = (key: string) => {
	const parts: string[] = [];
	let quote: string | undefined;
	let escaped = false;
	let current = '';
	for (const character of key) {
		if (escaped) {
			escaped = false;
			current += character;
			continue;
		}
		if (quote) {
			if (character === '\\' && quote === '"') escaped = true;
			else if (character === quote) quote = undefined;
			current += character;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			current += character;
			continue;
		}
		if (character === '.') {
			parts.push(current);
			current = '';
			continue;
		}
		current += character;
	}
	parts.push(current);
	return parts.map(unquote).filter(Boolean);
};

const escapes: Record<string, string> = {
	b: '\b',
	f: '\f',
	n: '\n',
	r: '\r',
	t: '\t',
	'"': '"',
	'\\': '\\'
};

/** The value of a double-quoted TOML string, with its escapes resolved. */
const unescape = (text: string) =>
	text.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_match, code: string) =>
		code.length > 1
			? String.fromCodePoint(Number.parseInt(code.slice(1), 16))
			: (escapes[code] ?? code)
	);

const number = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/;
const special = /^[+-]?(?:inf|nan)$|^0(?:[xX][0-9a-fA-F_]+|[oO][0-7_]+|[bB][01_]+)$/;
const datetime = /^\d{4}-\d{2}-\d{2}(?:[Tt ].*)?$|^\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$/;

/** What the status does with a value: it reads it, validly ignores it, or cannot read the document. */
type Value =
	| { readonly kind: 'value'; readonly value: Scalar }
	| { readonly kind: 'ignored' }
	| { readonly kind: 'invalid' };

/** A scalar value, an array, an inline table, a date, or something the reader cannot parse. */
const value = (text: string): Value => {
	if (text === '') return { kind: 'invalid' };

	const quote = text[0];
	if (quote === '"' || quote === "'") {
		if (text.length < 2 || text.at(-1) !== quote) return { kind: 'invalid' };
		const body = text.slice(1, -1);
		return { kind: 'value', value: quote === '"' ? unescape(body) : body };
	}

	if (text === 'true') return { kind: 'value', value: true };
	if (text === 'false') return { kind: 'value', value: false };
	if (number.test(text)) return { kind: 'value', value: Number(text) };

	// Arrays, inline tables, dates, and the special numbers are valid, but the status reads none of them.
	if (text.startsWith('[') || text.startsWith('{')) {
		return balance(text) === 0 ? { kind: 'ignored' } : { kind: 'invalid' };
	}
	if (special.test(text) || datetime.test(text)) return { kind: 'ignored' };

	return { kind: 'invalid' };
};

/** The multi-line string a value opens: the delimiter that ends it, and its text when it closes on the same line. */
type Multiline =
	| { readonly delimiter: string; readonly closes: false }
	| { readonly delimiter: string; readonly closes: true; readonly value: string };

const multiline = (text: string): Multiline | undefined => {
	const delimiter = ['"""', "'''"].find((candidate) => text.startsWith(candidate));
	if (!delimiter) return undefined;
	const end = text.indexOf(delimiter, 3);
	if (end < 0) return { delimiter, closes: false };
	return { delimiter, closes: true, value: text.slice(3, end) };
};

/** A block the reader skips: a multi-line string until its delimiter, or bracketed nesting until it closes. */
type Skip = { readonly until: string } | { depth: number };

/** The bracket nesting a value opens, ignoring brackets inside quoted strings. */
const balance = (text: string) => {
	let depth = 0;
	let quote: string | undefined;
	let escaped = false;
	for (const character of text) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quote) {
			if (character === '\\' && quote === '"') escaped = true;
			else if (character === quote) quote = undefined;
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === '[' || character === '{') depth++;
		else if (character === ']' || character === '}') depth--;
	}
	return depth;
};

/** Sets a value at a dotted path, creating the tables along it. */
const assign = (root: Toml, keys: string[], value: Toml | Scalar) => {
	let table = root;
	for (const key of keys.slice(0, -1)) {
		const next = table[key];
		if (isTable(next)) {
			table = next;
		} else {
			const created: Toml = {};
			table[key] = created;
			table = created;
		}
	}
	const last = keys.at(-1);
	if (last) table[last] = value;
};

/** What a value does to the reader: it assigns a value, or the body that follows must be skipped first. */
type Reading = Value | { readonly kind: 'skip'; readonly skip: Skip };

/** Reads the value of an assignment, including the blocks the status ignores. */
const read = (text: string): Reading => {
	const string = multiline(text);
	if (string) {
		return string.closes
			? { kind: 'value', value: string.value }
			: { kind: 'skip', skip: { until: string.delimiter } };
	}
	const depth = balance(text);
	if (depth > 0) return { kind: 'skip', skip: { depth } };
	return value(text);
};

/** The error a malformed document raises, so the host can report the project as not configured. */
const invalid = (line: number) => new Error(`Invalid TOML at line ${line}.`);

/** Parses the parts of a TOML document the local stack status reads. */
export const parse = (text: string): Toml => {
	const root: Toml = {};
	let table: string[] = [];
	let skip: Skip | undefined;

	const lines = stripComments(text).split('\n');
	for (const [index, line] of lines.entries()) {
		const content = line.trim();
		if (skip) {
			if ('until' in skip) {
				if (content.includes(skip.until)) skip = undefined;
			} else {
				skip.depth += balance(content);
				if (skip.depth <= 0) skip = undefined;
			}
			continue;
		}
		if (!content) continue;

		const header = /^\[\[?(.+?)\]\]?$/.exec(content);
		if (header) {
			table = path(header[1] ?? '');
			if (table.length) assign(root, table, {});
			continue;
		}

		const pair = assignment(content);
		const keys = pair ? [...table, ...path(pair.key)] : [];
		if (!pair || !keys.length) throw invalid(index + 1);

		const reading = read(pair.value);
		if (reading.kind === 'invalid') throw invalid(index + 1);
		if (reading.kind === 'skip') skip = reading.skip;
		else if (reading.kind === 'value') assign(root, keys, reading.value);
	}

	if (skip) throw invalid(lines.length);
	return root;
};
