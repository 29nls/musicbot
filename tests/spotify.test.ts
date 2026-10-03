import { describe, expect, it } from 'vitest';
import {
  DURATION_SOFT_LIMIT_MS,
  SpotifyMetadataService,
  mapTrack,
  matchNote,
  parseSpotifyLink,
  pickSpotifyMatch,
  resolveSpotifyPlay,
  searchQueryFor,
  toPlayInfo,
  toSpotifyMeta,
  unsupportedLinkMessage,
  type SpotifyHttpRequest,
  type SpotifyHttpResponse,
  type SpotifyTrackMeta,
} from '../src/modules/spotify/index.js';
import { addedToQueueEmbed } from '../src/modules/music/index.js';
import type { RawTrack, SearchOutcome } from '../src/modules/music/index.js';

const TRACK_ID = '4cOdK2wGLETKBW3PvgPWqT';

const META = toSpotifyMeta({
  id: TRACK_ID,
  title: 'Indonesia Raya',
  artists: ['Cakra harus Teka', 'Reza Artamevia'],
  album: 'Nusantara',
  imageUrl: 'https://i.scdn.co/image/abc',
  durationMs: 200_000,
});

function rawTrack(overrides: Partial<RawTrack['info']> & { title: string }): RawTrack {
  return {
    encoded: 'data',
    info: {
      title: overrides.title,
      author: overrides.author ?? 'Cakra harus Teka',
      length: overrides.length ?? 200_000,
      isStream: overrides.isStream ?? false,
      uri: overrides.uri ?? 'https://youtu.be/abc',
    },
  };
}

describe('parseSpotifyLink', () => {
  it('membaca track ID dari URL dan URI', () => {
    expect(parseSpotifyLink(`https://open.spotify.com/track/${TRACK_ID}?si=abcdef`)).toEqual({
      kind: 'track',
      id: TRACK_ID,
    });
    expect(parseSpotifyLink(`http://open.spotify.com/track/${TRACK_ID}`)).toEqual({
      kind: 'track',
      id: TRACK_ID,
    });
    expect(parseSpotifyLink(`spotify:track:${TRACK_ID}`)).toEqual({ kind: 'track', id: TRACK_ID });
  });

  it('mengenali playlist & album supaya bisa ditolak dengan jelas', () => {
    expect(parseSpotifyLink(`https://open.spotify.com/playlist/${TRACK_ID}`).kind).toBe('playlist');
    expect(parseSpotifyLink(`https://open.spotify.com/album/${TRACK_ID}`).kind).toBe('album');
    expect(unsupportedLinkMessage({ kind: 'playlist', id: TRACK_ID })).toContain('playlist');
  });

  it('menganggap input biasa sebagai bukan Spotify', () => {
    for (const input of [
      'indo',
      'https://youtu.be/abc',
      'https://spotify.com/track/pendek',
      `https://open.spotify.com/track/${TRACK_ID}x`,
      '',
      '   ',
    ]) {
      expect(parseSpotifyLink(input).kind).toBe('none');
    }
  });
});

describe('pickSpotifyMatch', () => {
  it('memilih judul yang sama persis dan durasi paling dekat', () => {
    const match = pickSpotifyMatch({
      meta: META,
      candidates: [
        { ...toInfo('Indonesia Raya (live)'), durationMs: 200_000 },
        { ...toInfo('Indonesia Raya'), durationMs: 200_400 },
        { ...toInfo('Indonesia Raya'), durationMs: 201_000 },
      ],
    });

    expect(match?.track.title).toBe('Indonesia Raya');
    expect(match?.durationDiffMs).toBe(400);
    expect(match?.exactTitle).toBe(true);
    expect(match?.alternatives).toBe(2);
  });

  it('membuang kandidat yang judulnya beda atau durasinya jauh', () => {
    const match = pickSpotifyMatch({
      meta: META,
      candidates: [
        toInfo('Lagu Lain'),
        { ...toInfo('Indonesia Raya'), durationMs: 200_000 + DURATION_SOFT_LIMIT_MS + 1_000 },
        { ...toInfo('Indonesia Raya Live Reaction'), durationMs: 200_000 },
      ],
    });

    expect(match?.track.title).toBe('Indonesia Raya Live Reaction');
  });

  it('tidak memutar apa pun kalau tidak ada yang cocok', () => {
    expect(
      pickSpotifyMatch({ meta: META, candidates: [toInfo('Lagu Completely Lain')] }),
    ).toBeNull();
    expect(pickSpotifyMatch({ meta: META, candidates: [] })).toBeNull();
  });

  it('menyamakan judul yang berbeda hanya tanda baca & huruf besar', () => {
    const match = pickSpotifyMatch({
      meta: toSpotifyMeta({
        id: TRACK_ID,
        title: 'Halo, Duniaku!',
        artists: ['Artis'],
        album: '',
        durationMs: 100_000,
      }),
      candidates: [
        {
          ...toInfo('halo duniaku'),
          author: 'Artis',
          durationMs: 100_000,
        },
      ],
    });

    expect(match?.exactTitle).toBe(true);
  });

  it('catatan jujur menyebut selisih durasi', () => {
    expect(
      matchNote({ track: toInfo('x'), durationDiffMs: 0, exactTitle: true, alternatives: 0 }),
    ).toContain('cocok persis');
    expect(
      matchNote({ track: toInfo('x'), durationDiffMs: 3_000, exactTitle: false, alternatives: 0 }),
    ).toContain('3 detik');
  });
});

/** Bentuk TrackInfo untuk kandidat pencocokan. */
function toInfo(title: string): import('../src/modules/music/index.js').TrackInfo {
  return {
    encoded: 'data',
    title,
    author: 'Cakra harus Teka',
    durationMs: 200_000,
    uri: 'https://youtu.be/abc',
    artworkUrl: null,
    isStream: false,
    requesterId: '1',
  };
}

describe('searchQueryFor', () => {
  it('menggabungkan judul dan artis pertama', () => {
    expect(searchQueryFor(META)).toBe('Indonesia Raya Cakra harus Teka');
    expect(searchQueryFor(toSpotifyMeta({ id: TRACK_ID, title: 'Solo', artists: [], album: '', durationMs: 1 }))).toBe(
      'Solo',
    );
  });
});

describe('SpotifyMetadataService', () => {
  const calls: SpotifyHttpRequest[] = [];

  function service(
    responses: Record<string, SpotifyHttpResponse>,
    clientId = 'id',
    clientSecret = 'secret',
  ): SpotifyMetadataService {
    calls.length = 0;

    return new SpotifyMetadataService({
      clientId,
      clientSecret,
      now: () => 1_000_000,
      transport: async (request) => {
        calls.push(request);
        const key = request.url.includes('/api/token') ? 'token' : 'track';
        return responses[key] ?? { ok: false, status: 404, body: null };
      },
    });
  }

  const okTrack: SpotifyHttpResponse = {
    ok: true,
    status: 200,
    body: {
      id: TRACK_ID,
      name: 'Indonesia Raya',
      duration_ms: 200_000,
      explicit: false,
      artists: [{ name: 'Cakra harus Teka' }, { name: 'Reza Artamevia' }],
      album: {
        name: 'Nusantara',
        images: [
          { url: 'https://i.scdn.co/image/small', width: 64 },
          { url: 'https://i.scdn.co/image/big', width: 640 },
        ],
      },
    },
  };

  it('mengambil token sekali lalu memakai cache', async () => {
    const svc = service(okTokenAnd(okTrack));

    await svc.getTrack(TRACK_ID);
    await svc.getTrack(TRACK_ID);

    expect(calls.filter((call) => call.url.includes('/api/token'))).toHaveLength(1);
    expect(calls.at(-1)?.headers.Authorization).toBe('Bearer tok');
  });

  it('memetakan respons menjadi metadata, memilih cover terbesar', async () => {
    const svc = service(okTokenAnd(okTrack));

    const result = await svc.getTrack(TRACK_ID);

    expect(result.kind).toBe('found');
    expect(result.kind === 'found' && result.track).toMatchObject({
      id: TRACK_ID,
      title: 'Indonesia Raya',
      artists: ['Cakra harus Teka', 'Reza Artamevia'],
      album: 'Nusantara',
      imageUrl: 'https://i.scdn.co/image/big',
      durationMs: 200_000,
    });
  });

  it('token ditolak dibaca sebagai masalah kredensial, bukan lagu hilang', async () => {
    const svc = service({ token: { ok: false, status: 401, body: null } });

    const result = await svc.getTrack(TRACK_ID);

    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.message).toContain('SPOTIFY_CLIENT_ID');
  });

  it('membedakan 404, 429, dan jaringan putus', async () => {
    const notFound = service(okTokenAnd({ ok: false, status: 404, body: null }));
    const limited = service(okTokenAnd({ ok: false, status: 429, body: null }));

    expect((await notFound.getTrack(TRACK_ID)).kind).toBe('not-found');
    expect((await limited.getTrack(TRACK_ID)).kind).toBe('error');

    calls.length = 0;
    const broken = new SpotifyMetadataService({
      clientId: 'id',
      clientSecret: 'secret',
      transport: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect((await broken.getTrack(TRACK_ID)).kind).toBe('error');
  });

  it('kredensial kosong = fitur belum aktif, bukan error', async () => {
    const svc = service({}, '', '');

    expect(svc.isConfigured).toBe(false);
    expect((await svc.getTrack(TRACK_ID)).kind).toBe('not-configured');
    expect(calls).toHaveLength(0);
  });

  it('respons dengan bentuk aneh ditolak, bukan ditampilkan setengah jadi', () => {
    expect(mapTrack(null)).toBeNull();
    expect(mapTrack({ id: TRACK_ID })).toBeNull();
    expect(mapTrack({ name: 'Tanpa ID' })).toBeNull();
  });
});

const okToken: SpotifyHttpResponse = {
  ok: true,
  status: 200,
  body: { access_token: 'tok', expires_in: 3_600 },
};

function okTokenAnd(track: SpotifyHttpResponse): Record<string, SpotifyHttpResponse> {
  return { token: okToken, track };
}

describe('resolveSpotifyPlay', () => {
  const deps = (overrides: Partial<{
    meta: (id: string) => Promise<{ kind: 'found'; track: SpotifyTrackMeta } | { kind: 'error'; message: string } | { kind: 'not-configured' } | { kind: 'not-found'; message: string }>;
    search: (query: string) => Promise<SearchOutcome>;
  }> = {}) => ({
    meta: overrides.meta ?? (async () => ({ kind: 'found' as const, track: META })),
    search: overrides.search ?? (async () => ({ kind: 'tracks' as const, tracks: [rawTrack({ title: 'Indonesia Raya' })] })),
    requesterId: 'user-1',
  });

  it('mengambil metadata lalu mengembalikan track yang cocok', async () => {
    const result = await resolveSpotifyPlay(`https://open.spotify.com/track/${TRACK_ID}`, deps());

    expect(result.kind).toBe('resolved');
    expect(result.kind === 'resolved' && result.track.requesterId).toBe('user-1');
    expect(result.kind === 'resolved' && result.match.exactTitle).toBe(true);
  });

  it('query biasa bukan Spotify — perintah harus lanjut ke jalur Lavalink', async () => {
    const result = await resolveSpotifyPlay('lagu deploy', deps());

    expect(result.kind).toBe('unsupported');
    expect(result.kind === 'unsupported' && result.message).toContain('bukan tautan track');
  });

  it('playlist ditolak sebelum memanggil Spotify sama sekali', async () => {
    let called = false;
    const result = await resolveSpotifyPlay(
      `https://open.spotify.com/playlist/${TRACK_ID}`,
      deps({
        meta: async () => {
          called = true;
          return { kind: 'found', track: META };
        },
      }),
    );

    expect(result.kind).toBe('unsupported');
    expect(called).toBe(false);
  });

  it('status dari metadata diteruskan apa adanya', async () => {
    expect(
      (await resolveSpotifyPlay(`https://open.spotify.com/track/${TRACK_ID}`, deps({ meta: async () => ({ kind: 'not-configured' }) }))).kind,
    ).toBe('not-configured');

    expect(
      (
        await resolveSpotifyPlay(
          `https://open.spotify.com/track/${TRACK_ID}`,
          deps({ meta: async () => ({ kind: 'not-found', message: 'tidak ada' }) }),
        )
      ).kind,
    ).toBe('not-found');

    expect(
      (
        await resolveSpotifyPlay(
          `https://open.spotify.com/track/${TRACK_ID}`,
          deps({ meta: async () => ({ kind: 'error', message: 'spotify down' }) }),
        )
      ).kind,
    ).toBe('error');
  });

  it('Lavalink mati diteruskan sebagai masalah pencarian', async () => {
    const result = await resolveSpotifyPlay(
      `https://open.spotify.com/track/${TRACK_ID}`,
      deps({ search: async () => ({ kind: 'unavailable' }) }),
    );

    expect(result.kind).toBe('search-failed');
  });

  it('hasil yang tidak cocok dilaporkan, bukan dipaksa diputar', async () => {
    const result = await resolveSpotifyPlay(
      `https://open.spotify.com/track/${TRACK_ID}`,
      deps({
        search: async () => ({
          kind: 'tracks',
          tracks: [rawTrack({ title: 'Reaksi Video', length: 60_000 })],
        }),
      }),
    );

    expect(result.kind).toBe('no-match');
    expect(result.kind === 'no-match' && result.tried).toBe(1);
  });

  it('play info honestly menyebut judul sumber audio', async () => {
    const result = await resolveSpotifyPlay(`https://open.spotify.com/track/${TRACK_ID}`, deps());

    if (result.kind !== 'resolved') throw new Error('harus resolved');
    const info = toPlayInfo(result.meta, result.match);

    expect(info.title).toBe('Indonesia Raya');
    expect(info.sourceTitle).toBe('Indonesia Raya');
    expect(info.matchNote).toContain('cocok persis');
  });
});

describe('embed /play dengan metadata Spotify', () => {
  it('menampilkan judul Spotify, sumber audio, dan catatan pencocokan', () => {
    const json = addedToQueueEmbed({
      kind: 'added',
      tracks: [toInfo('Indonesia Raya')],
      started: true,
      position: 0,
      skipped: 0,
      spotify: {
        title: 'Indonesia Raya',
        artists: ['Cakra harus Teka', 'Reza Artamevia'],
        album: 'Nusantara',
        imageUrl: 'https://i.scdn.co/image/abc',
        url: 'https://open.spotify.com/track/abc',
        sourceTitle: 'Indonesia Raya (Official Video)',
        sourceUri: 'https://youtu.be/abc',
        matchNote: 'Durasi audio 1 detik berbeda dari metadata Spotify.',
      },
    }).toJSON();

    const fields = JSON.stringify(json.fields);
    expect(fields).toContain('Dari Spotify');
    expect(fields).toContain('open.spotify.com/track/abc');
    expect(fields).toContain('Indonesia Raya (Official Video)');
    expect(fields).toContain('1 detik berbeda');
    expect(json.thumbnail?.url).toBe('https://i.scdn.co/image/abc');
  });

  it('tanpa Spotify, embed tidak bertambah field apa pun', () => {
    const json = addedToQueueEmbed({
      kind: 'added',
      tracks: [toInfo('Indonesia Raya')],
      started: true,
      position: 0,
      skipped: 0,
    }).toJSON();

    expect(JSON.stringify(json.fields ?? [])).not.toContain('Dari Spotify');
  });
});