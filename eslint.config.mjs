// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**', 'design/**', 'worker/public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 画面側（ブラウザで動く）は browser のグローバルを許可
    files: ['worker/ui/**/*.ts'],
    languageOptions: {
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', fetch: 'readonly',
        location: 'readonly', crypto: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', console: 'readonly', HTMLElement: 'readonly',
        Element: 'readonly', Event: 'readonly', MouseEvent: 'readonly', KeyboardEvent: 'readonly',
        HTMLInputElement: 'readonly', HTMLButtonElement: 'readonly', HTMLTemplateElement: 'readonly',
        Response: 'readonly', RequestInit: 'readonly', AbortController: 'readonly', URL: 'readonly',
        localStorage: 'readonly', Intl: 'readonly', Node: 'readonly', NodeListOf: 'readonly',
      },
    },
  },
  {
    rules: {
      // 秘密情報や任意コマンドの混入を防ぐため、console.log でのダンプを禁止（logger を使う）
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // 導入キットのスクリプト（人が手元で実行する CLI。結果を画面に出すので console を許可）
    files: ['kit/**/*.mjs', 'docs/media/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
);
