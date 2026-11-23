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

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<NextResponse> {
  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'invalid-id' }, { status: 400 });

  const session = await readSessionOrDev();
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  try {
    const found = await getDashboardPlaylistService().findPersonalById(session.userId, id);
    if (!found.ok) return NextResponse.json({ error: 'not-found' }, { status: 404 });

    return NextResponse.json(
      { playlist: serializePlaylist(found.value) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'database-down' }, { status: 503 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return NextResponse.json({ error: 'bad-origin' }, { status: 403 });
  }

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'invalid-id' }, { status: 400 });

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
    const result = await getDashboardPlaylistService().renamePersonal(session.userId, id, name);
    if (!result.ok) {
      const failure = playlistFailure(result.error);
      return NextResponse.json(
        { error: failure.error, message: failure.message },
        { status: failure.status },
      );
    }

    return NextResponse.json(
      { ok: true, playlist: serializePlaylist(result.value) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'database-down' }, { status: 503 });
  }
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return NextResponse.json({ error: 'bad-origin' }, { status: 403 });
  }

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'invalid-id' }, { status: 400 });

  const session = await readSessionOrDev();
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const rate = await checkRateLimit(`dash:playlist:write:${session.userId}`, 30);
  if (!rate.allowed) {
    const headers = rate.retryAfterSeconds
      ? { 'retry-after': String(rate.retryAfterSeconds) }
      : undefined;
    return NextResponse.json({ error: rate.reason }, { status: rate.reason === 'rate-limited' ? 429 : 503, headers });
  }

  try {
    const result = await getDashboardPlaylistService().removePersonal(session.userId, id);
    if (!result.ok) return NextResponse.json({ error: 'not-found' }, { status: 404 });

    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'database-down' }, { status: 503 });
  }
}
