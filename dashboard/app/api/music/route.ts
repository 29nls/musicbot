import { NextResponse } from 'next/server';
import { playerOwnerKey } from '@bot/modules/music/ownership.js';
import { decodePlayerSnapshot, playerStateKey } from '@bot/modules/music/playerState.js';
import { sharedStateKey } from '@bot/modules/music/sharedState.js';
import { decodeSharedMusicState } from '@bot/modules/music/sharedStateCodec.js';
import { guildIdFrom } from '@/lib/apiGuard.js';
import { botPermissionDeps } from '@/lib/discord.js';
import { getEnv } from '@/lib/env.js';
import { buildMusicState } from '@/lib/musicState.js';
import { checkGuildAccess } from '@/lib/permissions.js';
import { getStore } from '@/lib/serverDeps.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Status pemutar untuk satu guild.
 *
 * Yang dibaca hanya store bersama: snapshot yang ditulis pemegang lease, antrean,
 * dan lease itu sendiri. Dashboard tidak pernah menebak dari state peramban.
 * Kalau store mati, jawabannya tetap 200 dengan `degraded: true` supaya UI bisa
 * menjelaskan keadaannya, bukan menampilkan halaman error kosong.
 */
export async function GET(request: Request): Promise<NextResponse> {
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

  let storeDown = false;
  let snapshot = null;
  let queue = decodeSharedMusicState(null);
  let leaseOwner: string | null = null;

  try {
    const store = getStore();
    const [rawSnapshot, rawQueue, rawLease] = await Promise.all([
      store.get(playerStateKey(guildId)),
      store.get(sharedStateKey(guildId)),
      store.get(playerOwnerKey(guildId)),
    ]);

    snapshot = decodePlayerSnapshot(rawSnapshot);
    queue = decodeSharedMusicState(rawQueue);
    leaseOwner = rawLease;
  } catch {
    storeDown = true;
  }

  return NextResponse.json(
    buildMusicState({
      guildId,
      snapshot,
      leaseOwner,
      queue: queue.tracks,
      loopMode: queue.loopMode,
      storeDown,
    }),
    { headers: { 'cache-control': 'no-store' } },
  );
}
