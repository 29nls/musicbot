// Konfigurasi Prisma CLI (generate/migrate/studio).
// Prisma 7 tidak lagi memuat .env otomatis, jadi dotenv dimuat di sini.
//
// CATATAN: file ini hanya dibaca Prisma CLI, bukan oleh bot saat runtime —
// bot memakai driver adapter dengan DATABASE_URL dari src/config/env.ts.
//
// Untuk Supabase (atau hosting Postgres terkelola lain) isi DIRECT_URL dengan
// koneksi direct/session. Prisma CLI menjalankan migrasi dalam satu sesi,
// dan transaction pooler (port 6543) tidak mendukung prepared statement —
// migrasi akan menggantung tanpa pesan yang menyebut penyebabnya. Lihat
// prisma/url.ts untuk aturan lengkapnya dan cara mengujinya.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { isTransactionPoolerUrl, resolveCliDatabaseUrl } from './prisma/url.js';

const databaseUrl = resolveCliDatabaseUrl(process.env);

if (!databaseUrl) {
  console.warn(
    '[prisma.config] DATABASE_URL/DIRECT_URL belum diisi. `prisma generate` tetap bisa jalan, ' +
      'tapi `npm run db:migrate` / `db:deploy` akan gagal. Salin .env.example ke .env lalu isi nilainya.',
  );
} else if (isTransactionPoolerUrl(databaseUrl)) {
  console.warn(
    '[prisma.config] URL ini menunjuk transaction pooler (port 6543). ' +
      'Prisma CLI tidak bisa menjalankan migrasi lewat sana — pakai direct atau session pooler (port 5432).',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Placeholder hanya supaya `prisma generate` bisa jalan sebelum .env dibuat.
    url: databaseUrl ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
