import { NextResponse } from 'next/server';
import { checkRateLimit, originAllowed } from '@/lib/apiGuard.js';
import {
  getDashboardPlaylistService,
  parseTrackInput,
  playlistFailure,
  serializePlaylist,
} from '@/lib/playlists.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return NextResponse.json({ error: 'bad-origin' }, { status: 403 });
  }

  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid-id' }, { status: 400 });
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

  const tracks = parseTrackInput((body as { tracks?: unknown })?.tracks);
  if (!tracks) return NextResponse.json({ error: 'invalid-tracks' }, { status: 400 });

  try {
    const result = await getDashboardPlaylistService().addTracksToPersonal(
      session.userId,
      id,
      tracks,
    );
    if (!result.ok) {
      const failure = playlistFailure(result.error);
      return NextResponse.json(
        { error: failure.error, message: failure.message },
        { status: failure.status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        playlist: serializePlaylist(result.value.playlist),
        added: result.value.added,
        skippedDuplicates: result.value.skippedDuplicates,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'database-down' }, { status: 503 });
  }
}
