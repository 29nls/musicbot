import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tes dashboard.
 *
 * **Alias sama seperti yang dipakai Next.js.** Kalau alias di sini berbeda dari
 * `tsconfig.json`/`next.config.mjs`, berkas bisa lolos tes dan gagal di build —
 * dan build lebih lambat ketahuan, jadi arahnya harus dibalik: yang tes yang
 * lebih ketat.
 *
 * **Cakupan hanya modul yang jadi syarat angka.** `SC-6` menyebut modul validasi
 * dan otorisasi ≥ 90%. Menambahkan `app/` dan `components/` ke cakupan akan
 * mengukur boilerplate React yang tidak butuh diligence dan menutupi angka yang
 * sebenarnya bermakna, jadi keduanya sengaja tidak diukur di sini.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@bot': path.join(dir, '..', 'src'),
      '@': dir,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: [
        'lib/configWrite.ts',
        'lib/permissions.ts',
        'lib/session.ts',
        'lib/rateLimit.ts',
        'lib/fieldCatalog.ts',
        'lib/audit.ts',
      ],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 90,
        statements: 90,
      },
    },
  },
});