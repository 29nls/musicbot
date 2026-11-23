import { NextResponse } from 'next/server';
import { checkRateLimit, originAllowed } from '@/lib/apiGuard.js';
import {
  getDashboardPlaylistService,
  parseMovePosition,
  playlistFailure,
  serializePlaylist,
} from '@/lib/playlists.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string; position: string }>;
}

/**
 * Pindahkan satu lagu ke posisi tujuan secara atomik.
 *
 * `position` di URL adalah posisi sumber 1-based dan `toPosition` di body
 * adalah posisi tujuan 1-based. Repository mengunci baris sebelum membaca dan
 * menulis ulang JSON, jadi dua tab yang mengubah urutan bersamaan tidak saling
 * menimpa.
 */
export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return NextResponse.json({ error: 'bad-origin' }, { status: 403 });
  }

  const { id: rawId, position: rawPosition } = await params;
  const id = Number(rawId);
  const position = Number(rawPosition);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid-id' }, { status: 400 });
  }
  if (!Number.isInteger(position) || position <= 0) {
    return NextResponse.json({ error: 'invalid-position' }, { status: 400 });
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

  const toPosition = parseMovePosition((body as { toPosition?: unknown })?.toPosition);
  if (!toPosition) return NextResponse.json({ error: 'invalid-position' }, { status: 400 });

  try {
    const result = await getDashboardPlaylistService().moveTrackInPersonal(
      session.userId,
      id,
      position - 1,
      toPosition - 1,
    );
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

/**
 * Hapus satu lagu berdasarkan posisi 1-based.
 *
 * `position` adalah `trackId` pada kontrak endpoint: `StoredTrack` tidak punya
 * ID sendiri, dan menambah kolom ID ke JSON akan membuat format track kedua.
 */
export async function DELETE(request: Request, { params }: RouteParams): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return NextResponse.json({ error: 'bad-origin' }, { status: 403 });
  }

  const { id: rawId, position: rawPosition } = await params;
  const id = Number(rawId);
  const position = Number(rawPosition);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid-id' }, { status: 400 });
  }
  if (!Number.isInteger(position) || position <= 0) {
    return NextResponse.json({ error: 'invalid-position' }, { status: 400 });
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

  try {
    const result = await getDashboardPlaylistService().removeTrackFromPersonal(
      session.userId,
      id,
      position - 1,
    );
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
