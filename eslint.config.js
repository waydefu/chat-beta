import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'functions/lib/**', 'node_modules*/**', 'functions/node_modules*/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'functions/src/**/*.ts', 'functions/tests/**/*.ts', 'vite.config.ts', 'playwright.config.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './functions/tsconfig.json', './functions/tsconfig.tests.json'],
        tsconfigRootDir: import.meta.dirname,
      },
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
