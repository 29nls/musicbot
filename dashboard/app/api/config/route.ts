import { NextResponse } from 'next/server';
import { toLocale } from '@bot/modules/i18n/types.js';
import { applyConfigPatch, type WriteFailureReason } from '@/lib/configWrite.js';
import { botPermissionDeps } from '@/lib/discord.js';
import { getEnv } from '@/lib/env.js';
import { configWriteDeps, getStore, readGuildConfig } from '@/lib/serverDeps.js';
import { checkManageGuild } from '@/lib/permissions.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';
import { log } from '@/lib/log.js';
import { recordDashboardWrite, recordDashboardWriteDenied } from '@/lib/metrics.js';

/**
 * Baca dan tulis konfigurasi guild.
 *
 * **`guildId` tidak pernah datang dari body permintaan.** Ia selalu dibaca dari
 * sesi yang sudah diverifikasi. Ini satu-satunya cara yang menutup skenario §2.4
 * baris 2: kalau `guildId` boleh datang dari body, orang cukup menulis ID server
 * lain dan hoping namanya lolos. Karena ID-nya dari sesi, dan sesi menulisnya
 * hanya setelah izin dicek, tidak ada jalur untuk menulis ke guild yang tidak
 * boleh ditulisnya.
 *
 * **Pemeriksaan origin pada setiap POST.** Cookie sesi `sameSite=lax` sudah
 * menyaring sebagian besar serangan lintas situs, tapi `lax` masih mengirim
 * cookie pada navigasi tingkat atas — termasuk POST dari form di situs lain.
 * Karena itu `Origin` dibandingkan dengan `DASHBOARD_URL` sebelum body dibaca,
 * dan penolakannya 403 tanpa pesan: bentuk pesan tidak penting, yang penting
 * permintaan itu tidak pernah sampai ke jalur tulis.
 *
 * **Status yang dipakai** netral terhadap apa yang terjadi:
 * `400` body tidak dikenal, `403` tidak punya izin atau origin salah, `404`
 * server tidak ada untuk bot, `409` ID bukan milik server itu, `422` nilai tidak
 * valid, `429` kena rate limit, `503` database atau kanal bersama mati.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FAILURE_STATUS: Record<WriteFailureReason, number> = {
  'invalid-field': 400,
  'invalid-value': 422,
  forbidden: 403,
  'permission-unknown': 503,
  'foreign-id': 409,
  'rate-limited': 429,
  'shared-store-down': 503,
  'database-down': 503,
};

/**
 * Asal sah untuk POST.
 *
 * **Dua asal diterima, dan keduanya aman.** `DASHBOARD_URL` yang dikonfigurasi,
 * dan asal dari request itu sendiri. Alasannya praktis dan nyata: satu dashboard
 * bisa dijangkau lewat beberapa nama — `localhost`, `127.0.0.1`, alamat LAN,
 * domain sebenarnya — dan hanya satu yang tercatat di environment. Kalau hanya
 * `DASHBOARD_URL` yang dibandingkan, mengubahnya sedikit saja akan membuat semua
 * penyimpanan ditolak 403 tanpa pesan yang jelas.
 *
 * **Kenapa membandingkan dengan asal request sendiri tetap aman.** Yang penting
 * adalah asal asing tidak pernah cocok: permintaan dari `https://evil.example`
 * ke `https://dashboard.example/api/config` punya `Origin: https://evil.example`,
 * yang tidak sama dengan kedua nilai di atas. Ditambah cookie sesi bersifat
 * host-only, jadi peramban tidak mengirimnya ke asal selain dashboard itu sendiri.
 *
 * `Origin` tidak selalu ada (permintaan dari klien yang bukan peramban). Kalau
 * tidak ada, cookie `sameSite=lax` yang menjadi penjaganya — persis seperti yang
 * terjadi pada `<img>` dan beacon, yang memang tidak bisa dibaca.
 */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  if (origin === getEnv().DASHBOARD_URL) return true;

  if (origin === new URL(request.url).origin) return true;

  // Host header: nama yang benar-benar dipakai peramban untuk menjangkau kita.
  // `request.url` tidak selalu memakainya — di balik reverse proxy, Next menyusun
  // URL dari host internal, jadi `127.0.0.1:3100` bisa menjadi `localhost:3100`.
  const host = request.headers.get('host');
  if (host) {
    const incoming = new URL(origin);

    return incoming.host === host && (incoming.protocol === 'http:' || incoming.protocol === 'https:');
  }

  return false;
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await readSessionOrDev();
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const guildId = new URL(request.url).searchParams.get('guildId') ?? session.selectedGuildId;
  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    return NextResponse.json({ error: 'no-guild' }, { status: 400 });
  }

  const token = getEnv().DISCORD_TOKEN;
  const verdict = await checkManageGuild(botPermissionDeps(token), guildId, session.userId);
  if (verdict === 'denied') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (verdict === 'unknown') return NextResponse.json({ error: 'permission-unknown' }, { status: 503 });

  const config = await readGuildConfig(guildId);

  return NextResponse.json(
    { guildId, locale: toLocale(config.locale), config },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function PATCH(request: Request): Promise<NextResponse> {
  if (!originAllowed(request)) {
    // Penolakan origin ikut dihitung (§4.5): di operasi normal
    // jumlahnya nol, jadi angka yang bukan nol berarti ada yang
    // salah — DASHBOARD_URL tidak cocok atau ada yang mengeksplorasi
    // CSRF. Berbeda dari `no-session`, yang rutin terjadi karena
    // sesi memang kedaluwarsa dan bukan pertanda insiden.
    await recordDashboardWriteDenied(getStore());
    return NextResponse.json({ error: 'bad-origin' }, { status: 403 });
  }

  const session = await readSessionOrDev();
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const guildId = new URL(request.url).searchParams.get('guildId') ?? session.selectedGuildId;
  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    return NextResponse.json({ error: 'no-guild' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const result = await applyConfigPatch(configWriteDeps(), {
    guildId,
    userId: session.userId,
    body,
  });

  if (!result.ok) {
    const status = FAILURE_STATUS[result.reason];
    const headers: Record<string, string> = {};
    if (result.retryAfterSeconds) headers['retry-after'] = String(result.retryAfterSeconds);

    // Penolakan karena kanal bersama atau database mati adalah masalah
    // infrastruktur, bukan salah pengguna. Keduanya harus terlihat di log dengan
    // level berbeda supaya operator bisa membedakan "sesi tidak berlaku" dari
    // "layanan sedang turun" — dua masalah yang perbaikannya tidak sama.
    const level = result.reason === 'shared-store-down' || result.reason === 'database-down' ? 'error' : 'warn';
    log[level]('config.write.rejected', {
      guildId,
      userId: session.userId,
      reason: result.reason,
      issues: result.issues,
      retryAfterSeconds: result.retryAfterSeconds,
    });

    // Penolakan dihitung apa pun alasannya: kegagalan otorisasi adalah
    // indikator paling awal bahwa ada yang salah (§4.5). Pencacahan
    // terbaik-usaha — tidak pernah menghalangi penolakan itu sendiri.
    await recordDashboardWriteDenied(getStore());

    return NextResponse.json({ error: result.reason, issues: result.issues }, { status, headers });
  }

  log.info('config.write.ok', {
    guildId,
    userId: session.userId,
    fields: result.changes.map((change) => change.field),
    auditRecorded: result.auditRecorded,
  });

  // Penulisan berhasil dihitung sesudah log, supaya dua sumber
  // observasi menceritakan peristiwa yang sama dalam urutan yang
  // sama. Terbaik-usaha, seperti pencacahan penolakan.
  await recordDashboardWrite(getStore());

  return NextResponse.json({
    ok: true,
    config: result.config,
    changes: result.changes,
    auditRecorded: result.auditRecorded,
    locale: toLocale(result.config.locale),
  });
}