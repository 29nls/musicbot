import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { publishDashboardMusicCommand } from '@bot/modules/music/dashboard.js';
import { checkRateLimit, guildIdFrom, originAllowed } from '@/lib/apiGuard.js';
import { botPermissionDeps } from '@/lib/discord.js';
import { getEnv } from '@/lib/env.js';
import { failureStatus, parseQuery, parseSearchSource } from '@/lib/musicApi.js';
import { waitForDashboardResult } from '@/lib/musicCommand.js';
import { checkGuildAccess } from '@/lib/permissions.js';
import { getStore } from '@/lib/serverDeps.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Cari lagu lewat resolver bot.
 *
 * Pencarian tetap dijalankan proses bot karena hanya proses itu yang punya
 * koneksi Lavalink dan kredensial Spotify. Dashboard hanya menunggu hasilnya di
 * store bersama.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return NextResponse.json({ error: 'bad-origin' }, { status: 403 });
  }

  const session = await readSessionOrDev();
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const guildId = guildIdFrom(request, session);
  if (!guildId) return NextResponse.json({ error: 'no-guild' }, { status: 400 });

  const verdict = await checkGuildAccess(
    botPermissionDeps(getEnv().DISCORD_TOKEN),
    guildId,
    session.userId,
  );
  if (verdict === 'denied') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (verdict === 'unknown') {
    return NextResponse.json({ error: 'permission-unknown' }, { status: 503 });
  }

  const rate = await checkRateLimit(`dash:music:search:${guildId}:${session.userId}`, 30);
  if (!rate.allowed) {
    const headers = rate.retryAfterSeconds
      ? { 'retry-after': String(rate.retryAfterSeconds) }
      : undefined;
    return NextResponse.json({ error: rate.reason }, { status: rate.reason === 'rate-limited' ? 429 : 503, headers });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const payload = body as { query?: unknown; source?: unknown };
  const query = parseQuery(payload.query);
  if (!query) return NextResponse.json({ error: 'invalid-query' }, { status: 400 });

  const source = parseSearchSource(payload.source) ?? 'youtube';
  const requestId = randomBytes(16).toString('hex');
  const store = getStore();
  const sent = await publishDashboardMusicCommand(store, {
    guildId,
    userId: session.userId,
    requestId,
    createdAt: Date.now(),
    command: { kind: 'search', query, source },
  });

  if (!sent) return NextResponse.json({ error: 'not-sent' }, { status: 503 });

  const waited = await waitForDashboardResult(requestId, {
    readResult: (key) => store.get(key),
    deleteResult: (key) => store.delete(key),
  });

  if (waited.status === 'store-error') {
    return NextResponse.json({ error: 'shared-store-down' }, { status: 503 });
  }
  if (waited.status !== 'result') {
    return NextResponse.json({ error: 'timeout' }, { status: 504 });
  }

  return NextResponse.json(
    { ok: waited.result.ok, result: waited.result },
    {
      status: waited.result.ok ? 200 : failureStatus(waited.result.reason),
      headers: { 'cache-control': 'no-store' },
    },
  );
}
