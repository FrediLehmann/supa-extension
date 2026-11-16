import prettier from 'eslint-config-prettier';
import solid from 'eslint-plugin-solid';
import tseslint from 'typescript-eslint';

import js from '@eslint/js';

export default tseslint.config(
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'.hashtrack/**',
			'supabase/.branches/**',
			'supabase/.temp/**'
		]
	},
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		files: ['**/*.tsx'],
		...solid.configs['flat/typescript']
	},
	{
		linterOptions: {
			reportUnusedDisableDirectives: 'error'
		}
	},
	prettier
);
