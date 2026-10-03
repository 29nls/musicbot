import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { getLogger } from './logger.js';

let client: PrismaClient | undefined;

/**
 * Client Prisma tunggal (lazy).
 *
 * Prisma 7 mewajibkan driver adapter; kita pakai `pg`. Driver `pg` tidak punya
 * timeout bawaan, jadi connectionTimeoutMillis diisi supaya startup tidak
 * menggantung saat database mati.
 *
 * **Kenapa tetap Prisma + pg, bukan SDK Supabase.** Supabase adalah PostgreSQL,
 * dan bot ini selalu ke sana lewat satu connection string biasa. SDK
 * `@supabase/supabase-js` menulis ke Data API dan bergantung pada Row Level
 * Security — itu untuk aplikasi sisi klien yang tidak memegang kredensial
 * database. Bot punya skema dan migrasinya sendiri, jadi lapisan itu cuma
 * menambah satu tempat lagi untuk salah.
 *
 * **SSL mengikuti URL, tapi `sslmode=require` saja tidak cukup.** Driver `pg`
 * memetakan `require` menjadi verifikasi penuh: sertifikat server harus
 * ditandatangani CA yang dipercaya Node. Supabase memakai PKI sendiri
 * (leaf <- `Supabase Intermediate 2021 CA` <- `Supabase Root 2021 CA`) dan CA
 * itu tidak ada di trust store publik, jadi `sslmode=require` berakhir dengan
 * `self-signed certificate in certificate chain` — bukan di Prisma CLI (Rust
 * miliknya), tapi di sini. Yang dipakai runtime:
 *
 *   ?sslmode=verify-full&sslrootcert=C:/Users/.../global-root.crt
 *
 * `sslrootcert` dibaca driver dan ditambahkan ke trust store koneksi; path di
 * dalam query string ditulis dengan garis miring. Kalau CA belum pernah
 * diunduh dan verifikasi harus dinyalakan sekarang juga, `?sslmode=no-verify`
 * tetap terenkripsi tapi tidak memverifikasi identitas server.
 *
 * **Ukuran pool 5** wajar untuk backend yang hidup terus (bot), bukan serverless
 * yang memicu ribuan koneksi sesaat. Kalau nanti memakai transaction pooler
 * (port 6543), prepared statement harus dimatikan lewat `?pgbouncer=true`.
 */
export function getPrisma(): PrismaClient {
  if (!client) {
    const adapter = new PrismaPg({
      connectionString: getEnv().DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
    });

    const logger = getLogger();
    const instance = new PrismaClient({
      adapter,
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });

    instance.$on('warn', (event) => logger.warn({ prisma: event }, 'Peringatan Prisma'));
    instance.$on('error', (event) => logger.error({ prisma: event }, 'Error Prisma'));

    client = instance;
  }

  return client;
}

/**
 * Cek koneksi database saat startup.
 *
 * @returns true kalau database bisa dihubungi. Bot tetap dijalankan walau
 * database mati (perintah seperti /ping tidak butuh DB), tapi perintah yang
 * butuh konfigurasi akan gagal dengan pesan yang jelas.
 */
export async function connectDatabase(): Promise<boolean> {
  const logger = getLogger();

  try {
    await getPrisma().$queryRaw`SELECT 1`;
    logger.info('Database terhubung');
    return true;
  } catch (error) {
    logger.warn(
      { err: error },
      'Database tidak bisa dihubungi — perintah yang butuh konfigurasi akan gagal. ' +
        'Periksa `DATABASE_URL` di .env dan koneksi ke server database. ' +
        'Kalau errornya soal TLS atau sertifikat, `DATABASE_URL` butuh ' +
        '`sslmode=verify-full&sslrootcert=<path ke CA Supabase>` — lihat .env.example.',
    );
    return false;
  }
}

/**
 * Pingan cepat untuk health check: apakah database hidup?
 *
 * Tidak melempar — jawaban 'down' sudah cukup untuk laporan, dan health check
 * tidak boleh jadi sumber error baru yang flooding ke log.
 */
export async function pingDatabase(): Promise<'ok' | 'down'> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'down';
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = undefined;
}
