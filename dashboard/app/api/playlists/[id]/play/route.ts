import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { publishDashboardMusicCommand } from '@bot/modules/music/dashboard.js';
import type { Playlist, PlaylistResult } from '@bot/modules/playlists/types.js';
import { checkRateLimit, isSnowflake, originAllowed } from '@/lib/apiGuard.js';
import { botPermissionDeps } from '@/lib/discord.js';
import { getEnv } from '@/lib/env.js';
import { failureStatus } from '@/lib/musicApi.js';
import { waitForDashboardResult } from '@/lib/musicCommand.js';
import { getDashboardPlaylistService } from '@/lib/playlists.js';
import { checkGuildAccess } from '@/lib/permissions.js';
import { getStore } from '@/lib/serverDeps.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Muat playlist personal ke antrean aktif lewat proses bot.
 *
 * Route memeriksa kepemilikan playlist dan keanggotaan guild; bot mengulang
 * pemeriksaan yang sama plus DJ, voice, dan resolver. Playlist tidak di-resolve
 * di Next.js karena resolver hanya ada di proses bot.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return NextResponse.json({ error: 'bad-origin' }, { status: 403 });
  }

  const { id: raw } = await params;
  const playlistId = Number(raw);
  if (!Number.isInteger(playlistId) || playlistId <= 0) {
    return NextResponse.json({ error: 'invalid-id' }, { status: 400 });
  }

  const session = await readSessionOrDev();
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const guildId = (body as { guildId?: unknown })?.guildId;
  if (!isSnowflake(guildId)) {
    return NextResponse.json({ error: 'no-guild' }, { status: 400 });
  }

  const verdict = await checkGuildAccess(
    botPermissionDeps(getEnv().DISCORD_TOKEN),
    guildId,
    session.userId,
  );
  if (verdict === 'denied') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (verdict === 'unknown') {
    return NextResponse.json({ error: 'permission-unknown' }, { status: 503 });
  }

  const rate = await checkRateLimit(`dash:music:cmd:${guildId}:${session.userId}`, 40);
  if (!rate.allowed) {
    const headers = rate.retryAfterSeconds
      ? { 'retry-after': String(rate.retryAfterSeconds) }
      : undefined;
    return NextResponse.json({ error: rate.reason }, { status: rate.reason === 'rate-limited' ? 429 : 503, headers });
  }

  // Kepemilikan diperiksa sebelum perintah diterbitkan: bot tetap memeriksa
  // ulang, tapi menolak lebih awal membuat UI tidak menunggu timeout untuk
  // playlist yang memang bukan milik user ini.
  let found: PlaylistResult<Playlist>;
  try {
    found = await getDashboardPlaylistService().findPersonalById(session.userId, playlistId);
  } catch {
    return NextResponse.json({ error: 'database-down' }, { status: 503 });
  }
  if (!found.ok) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const requestId = randomBytes(16).toString('hex');
  const store = getStore();
  const sent = await publishDashboardMusicCommand(store, {
    guildId,
    userId: session.userId,
    requestId,
    createdAt: Date.now(),
    command: { kind: 'playlist', playlistId },
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
