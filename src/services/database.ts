import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { getLogger } from '../modules/logger/index.js';

let client: PrismaClient | undefined;

/**
 * Client Prisma tunggal (lazy).
 *
 * Prisma 7 mewajibkan driver adapter; kita pakai `pg`. Driver `pg` tidak punya
 * timeout bawaan, jadi connectionTimeoutMillis diisi supaya startup tidak
 * menggantung saat database mati.
 *
 * Database-nya Postgres lokal di container `postgres`, jadi tidak ada SSL,
 * pooler, atau sertifikat yang perlu diurus: koneksinya lewat jaringan Docker
 * atau localhost.
 *
 * **Ukuran pool 5** wajar untuk backend yang hidup terus (bot), bukan serverless
 * yang memicu ribuan koneksi sesaat.
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
        'Periksa `DATABASE_URL` di .env lalu apakah container `postgres` hidup ' +
        '(`docker compose ps postgres`).',
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
