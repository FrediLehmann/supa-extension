import { Rpc } from '@opencode/plugin/rpc';

const input = {
	type: 'object',
	properties: {
		directory: { type: 'string' },
		worktree: { type: 'string' }
	},
	required: ['directory'],
	additionalProperties: false
} as const;

const status = {
	type: 'object',
	properties: {
		configured: { type: 'boolean' },
		running: { type: 'boolean' },
		studio: { type: 'string' },
		mailpit: { type: 'string' }
	},
	required: ['configured', 'running', 'studio', 'mailpit'],
	additionalProperties: false
} as const;

const lifecycle = {
	type: 'object',
	properties: {
		ok: { type: 'boolean' },
		message: { type: 'string' }
	},
	required: ['ok', 'message'],
	additionalProperties: false
} as const;

export const Supabase = Rpc.define({
	id: 'supabase',
	methods: {
		status: { input, output: status },
		start: { input, output: lifecycle },
		stop: { input, output: lifecycle }
	},
	events: {}
});
