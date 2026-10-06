import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env.js';
import { clearSession } from '@/lib/sessionRoute.js';

/**
 * Keluar: hapus cookie sesi.
 *
 * **POST saja, bukan GET.** Link `<a href="/api/auth/logout">` bisa dipicu
 * otomatis — prefetch peramban, crawler, atau gambar di dalam `<img>`. Itu akan
 * mengeluarkan orang tanpa bertanya, dan pada dasarnya adalah CSRF. Form
 * `method="post"` yang dipakai halaman tidak bisa dipicu tanpa interaksi.
 *
 * Cookie dihapus, bukan hanya dikosongkan: cookie lama yang masih ada di browser
 * lain tidak ikut berubah, tapi sesi yang sudah dihapus di server memang sudah
 * tidak berlaku karena cookie itu tidak membawa server state apa pun.
 */
export async function POST(): Promise<NextResponse> {
  await clearSession();

  return NextResponse.redirect(new URL('/', getEnv().DASHBOARD_URL), { status: 303 });
}