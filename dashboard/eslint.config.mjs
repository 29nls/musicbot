import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint dashboard.
 *
 * **Cfg ini menjaga satu hal yang penting: dashboard dan bot punya aturan
 * berbeda, dan itu disengaja.** Dashboard adalah server component + route handler
 * Node; bukan bot yang punya `catch` wajib di setiap jalur async dan exit code
 * sendiri. Menyalin `eslint.config.mjs` bot apa adanya akan memaksa aturan yang
 * ditulis untuk sebuah proses yang harus keluar dengan kode numerik — ke dalam
 * route yang justru harus menjawab HTTP, bukan keluar.
 *
 * `node_modules` dan `.next` diabaikan karena keduanya sudah diimpor eslint
 * secara bawaan, tapi Next.js menyisipkan berkas hasil build di dalam paket
 * (`next-env.d.ts`) yang tidak boleh ikut dilaporkan — isinya ditulis Next.js,
 * bukan kita.
 */
export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` sering dipakai pada `JSON.parse` dan data dari Discord yang memang
      // tidak berbentuk. `strictNullChecks` sudah menyala di tsconfig, jadi tipe
      // yang longgar di sini selalu pilihan sadar, bukan bawaan.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Berkas uji boleh `any` untuk fixture; yang diuji bukan tipenya.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);