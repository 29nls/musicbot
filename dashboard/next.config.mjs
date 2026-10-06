import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '..');

/**
 * Konfigurasi Next.js untuk dashboard.
 *
 * Tiga hal yang tidak bawaan, dan alasannya:
 *
 * 1. **Impor dari `../src`.** Validasi, tipe, katalog bahasa, dan kanal
 *    invalidasi tidak disalin ke sini — kalau disalin, paritas dengan `/config`
 *    hanya benar sampai orang pertama yang lupa memperbarui salinan. Karena
 *    modul bot memakai gaya ESM dengan akhiran `.js` (`./types.js`) sementara
 *    berkasnya `.ts`, bundler perlu tahu padanannya; itu tugas `extensionAlias`.
 * 2. **`outputFileTracingRoot`.** Tanpa ini, Next mengira akar proyeknya
 *    `dashboard/`, sehingga berkas di `../src` dianggap di luar proyek dan
 *    peringatan/berkas standalone-nya salah.
 * 3. **`serverExternalPackages`.** Prisma dan ioredis harus tetap dimuat
 *    sebagai modul Node biasa, bukan dibundel — keduanya membawa bagian native
 *    atau mesinnya sendiri.
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: repoRoot,
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg', 'ioredis'],
  eslint: {
    // Lint dijalankan lewat `npm run lint` di paket ini, bukan di dalam build.
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // `./types.js` harus menemukan `types.ts` — sama seperti yang dilakukan
    // tsc dan tsx di sisi bot.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      ...(config.resolve.extensionAlias ?? {}),
    };

    return config;
  },
};

export default nextConfig;
