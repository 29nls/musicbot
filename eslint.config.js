import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `tools/` berisi skrip Node sekali pakai (pemeriksa karakter), bukan bagian dari build bot.
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'lavalink/**',
      'src/generated/**',
      'tools/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    // Skrip CLI yang dijalankan langsung oleh pengguna di server (mis.
    // `deploy/casaos/preflight.mjs`). Bedanya dari kode bot: ini wajib mencetak
    // ke stdout supaya pesannya terlihat, dan berjalan di Node, bukan di bundler.
    files: ['deploy/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
