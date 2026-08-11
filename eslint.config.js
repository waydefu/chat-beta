import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly',
        confirm: 'readonly', alert: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        HTMLElement: 'readonly', HTMLButtonElement: 'readonly', HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly', HTMLDialogElement: 'readonly', Node: 'readonly',
        btoa: 'readonly', TextEncoder: 'readonly', crypto: 'readonly', URL: 'readonly',
      },
    },
  },
  {
    files: ['public/firebase-messaging-sw.js'],
    languageOptions: {
      globals: { self: 'readonly', caches: 'readonly', URL: 'readonly', fetch: 'readonly', Promise: 'readonly' },
    },
  },
);
