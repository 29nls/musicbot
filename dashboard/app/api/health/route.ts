import { NextResponse } from 'next/server';
import { pingDatabase } from '@/lib/prisma.js';
import { getStore } from '@/lib/serverDeps.js';

/**
 * Health check dashboard: 200 saat bisa dipakai, 503 saat tidak.
 *
 * **Dua hal diperiksa, karena keduanya bisa mati tanpa yang lain ikut mati.**
 * Database mati berarti tidak ada yang bisa dibaca maupun ditulis. Kanal bersama
 * (Redis) mati berarti konfigurasi masih terbaca tapi perubahan tidak bisa
 * dijamin berlaku (D3). Kalau hanya database yang dicek, operator melihat
 * dashboard "sehat" padahal semua simpanan ditolak — persis kebohongan yang
 * D3 bilang harus dihindari.
 *
 * **Tanpa autentikasi, dan itu memang benar.** Isinya cuma status hidup/mati
 * untuk monitoring, sama seperti `/health` milik bot yang juga tanpa
 * autentikasi. Tidak ada nilai rahasia, tidak ada ID, tidak ada nama guild.
 *
 * `dynamic = 'force-dynamic'` wajib: kalau route ini ikut di-cache, health check
 * akan melaporkan keadaan lama — dan monitoring yang salah lebih berbahaya dari
 * monitoring yang tidak ada.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();

  const database = await pingDatabase();

  let sharedStore: 'ok' | 'down';
  try {
    await getStore().increment('harmony:dashboard:health', { ttlMs: 60_000 });
    sharedStore = 'ok';
  } catch {
    sharedStore = 'down';
  }

  const healthy = database === 'ok';
  const body = {
    status: healthy ? 'ok' : 'degraded',
    database,
    sharedStore,
    // Kemampuan dashboard sekarang: membaca selalu bisa selama database hidup,
    // menulis butuh database dan kanal bersama keduanya hidup.
    readWrite: healthy && sharedStore === 'ok',
    checkedInMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, { status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}

/** HEAD dipakai monitoring sebagian; jawabannya sama dengan GET. */
export async function HEAD(): Promise<NextResponse> {
  const response = await GET();

  return new NextResponse(null, { status: response.status, headers: response.headers });
}

/** Node runtime wajib: Prisma dan ioredis bukan modul edge. */
export const runtime = 'nodejs';