import { NextResponse } from 'next/server';
import { checkRateLimit, originAllowed } from '@/lib/apiGuard.js';
import {
  getDashboardPlaylistService,
  playlistFailure,
  serializePlaylist,
} from '@/lib/playlists.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Playlist personal milik user yang sedang login.
 *
 * Tidak ada `guildId` di sini, dan itu disengaja: playlist personal harus bisa
 * dibuka dari guild mana pun. Kepemilikan diambil dari session, bukan dari
 * parameter yang bisa dikirim peramban.
 */
export async function GET(): Promise<NextResponse> {
  const session = await readSessionOrDev();
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  try {
    const playlists = await getDashboardPlaylistService().listPersonal(session.userId);
    return NextResponse.json(
      { playlists: playlists.map(serializePlaylist) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'database-down' }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return NextResponse.json({ error: 'bad-origin' }, { status: 403 });
  }

  const session = await readSessionOrDev();
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const rate = await checkRateLimit(`dash:playlist:write:${session.userId}`, 30);
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

  const name = (body as { name?: unknown })?.name;
  if (typeof name !== 'string') {
    return NextResponse.json({ error: 'invalid-name' }, { status: 400 });
  }

  try {
    const result = await getDashboardPlaylistService().createPersonal(session.userId, name);
    if (!result.ok) {
      const failure = playlistFailure(result.error);
      return NextResponse.json(
        { error: failure.error, message: failure.message },
        { status: failure.status },
      );
    }

    return NextResponse.json(
      { ok: true, playlist: serializePlaylist(result.value) },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'database-down' }, { status: 503 });
  }
}
