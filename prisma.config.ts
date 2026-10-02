// Konfigurasi Prisma CLI (generate/migrate/studio).
// Prisma 7 tidak lagi memuat .env otomatis, jadi dotenv dimuat di sini.
//
// CATATAN: file ini hanya dibaca Prisma CLI, bukan oleh bot saat runtime —
// bot memakai driver adapter dengan DATABASE_URL dari src/config/env.ts.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn(
    '[prisma.config] DATABASE_URL belum diisi. `prisma generate` tetap bisa jalan, ' +
      'tapi `npm run db:migrate` / `db:deploy` akan gagal. Salin .env.example ke .env lalu isi nilainya.',
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
