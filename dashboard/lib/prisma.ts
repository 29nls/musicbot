import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@bot/generated/prisma/client.js';
import { getEnv } from './env.js';

/**
 * Klien Prisma dashboard.
 *
 * **Client-nya dipakai apa adanya dari repo bot** (`src/generated/prisma`), bukan
 * hasil generate baru di sini. Itu disengaja dan itu yang menjaga skema tetap
 * satu: kalau dashboard punya client-nya sendiri, penambahan kolom di
 * `prisma/schema.prisma` bisa terlihat di satu sisi dan tidak di sisi lain, dan
 * yang paling cepat hilang dari build adalah sisi yang paling jarang diuji,
 * yaitu sisi yang baru saja ditambahkan.
 *
 * **Bukan `NEXT_PUBLIC_` apa pun.** Prisma hanya dipakai di server component dan
 * route handler; peramban tidak pernah menyentuhnya.
 *
 * **Pool kecil (3)**, bukan 5 milik bot. Dashboard adalah layanan dengan
 * sedikit pengguna aktif, dan kedua layanan hidup di mesin yang sama dengan RAM
 * terbatas (PRD §11: VPS 2 GB). 3 koneksi sudah cukup untuk satu operator yang
 * membuka satu halaman; sisanya adalah RAM idle.
 *
 * `connectionTimeoutMillis` 5 detik mencegah satu halaman menggantung saat
 * database mati — sama seperti sisi bot, dan itu yang membuat `/api/health`
 * bisa menjawab 503 alih-alih tidak menjawab sama sekali.
 */

let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!client) {
    const adapter = new PrismaPg({
      connectionString: getEnv().DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5_000,
    });

    client = new PrismaClient({ adapter });
  }

  return client;
}

/**
 * Ping database untuk `/api/health`.
 *
 * Tidak melempar: health check tidak boleh jadi sumber error baru yang
 * flooding, dan "down" sudah cukup untuk laporan.
 */
export async function pingDatabase(): Promise<'ok' | 'down'> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'down';
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = undefined;
}