import { describe, expect, it } from 'vitest';
import {
  LYRICS_PLAIN_LINES,
  LyricsService,
  activeLineAt,
  buildLyricsQuery,
  cacheKey,
  cleanArtistName,
  cleanTrackTitle,
  decodeEntities,
  extractGeniusLyrics,
  findActiveLineIndex,
  firstNonEmpty,
  formatTimecode,
  hasLyrics,
  lyricsEmbed,
  parseLrc,
  parseLrcTimestamp,
  parsePlainLyrics,
  pickBestCandidate,
  selectLyricWindow,
  stripLrcTags,
  toDocument,
  type LyricsHttpGet,
  type LyricsHttpResponse,
} from '../src/modules/lyrics/index.js';
import type { LyricLine } from '../src/modules/lyrics/index.js';

const SYNCED_LRC = [
  '[ar:Banda Myth',
  '[ti:Lagu Uji',
  '[00:01.00]Baris pertama',
  '[00:12.50][01:30.00]Baris kedua',
  '[01:00.00]Baris ketiga',
].join('\n');

const lines = (...values: Array<[number, string]>): LyricLine[] =>
  values.map(([timeMs, text]) => ({ timeMs, text }));

describe('parseLrcTimestamp', () => {
  it('membaca detik polos dan pecahan detik', () => {
    expect(parseLrcTimestamp('[01:02]')).toBe(62_000);
    expect(parseLrcTimestamp('[00:12.5]')).toBe(12_500);
    expect(parseLrcTimestamp('[00:12.50]')).toBe(12_500);
    expect(parseLrcTimestamp('[00:12.505]')).toBe(12_505);
    expect(parseLrcTimestamp('[01:00:00]')).toBe(60_000);
  });

  it('menolak tag yang bukan timestamp', () => {
    for (const token of ['[ar:artist]', '[00:xx]', '00:12', '[]', '']) {
      expect(parseLrcTimestamp(token)).toBeNull();
    }
  });
});

describe('parseLrc', () => {
  it('membaca lirik sinkron, mengabaikan tag metadata', () => {
    const { lines: parsed, offsetMs } = parseLrc(SYNCED_LRC);

    expect(offsetMs).toBe(0);
    expect(parsed).toEqual([
      { timeMs: 1_000, text: 'Baris pertama' },
      { timeMs: 12_500, text: 'Baris kedua' },
      { timeMs: 60_000, text: 'Baris ketiga' },
      { timeMs: 90_000, text: 'Baris kedua' },
    ]);
    // Urut naik, walau file aslinya tidak terurut.
    expect(parsed.map((line) => line.timeMs)).toEqual([1_000, 12_500, 60_000, 90_000]);
  });

  it('menerapkan tag offset dan menjepit waktu negatif', () => {
    const { lines: parsed, offsetMs } = parseLrc(
      ['[offset:-800]', '[00:01.00]Satu', '[00:00.10]Dua'].join('\n'),
    );

    expect(offsetMs).toBe(-800);
    expect(parsed).toEqual([
      { timeMs: 0, text: 'Dua' },
      { timeMs: 200, text: 'Satu' },
    ]);
  });

  it('toleran: CRLF, baris tanpa waktu, dan teks kosong dilewati', () => {
    const { lines: parsed } = parseLrc(
      ['[00:02.00]Dua', '', 'ini lirik tanpa waktu', '[00:03.00]   ', '[00:04.00]Empat'].join(
        '\r\n',
      ),
    );

    expect(parsed).toEqual([
      { timeMs: 2_000, text: 'Dua' },
      { timeMs: 4_000, text: 'Empat' },
    ]);
  });
});

describe('stripLrcTags dan parsePlainLyrics', () => {
  it('melempar tag waktu di tengah teks', () => {
    expect(stripLrcTags('[00:12.00] Halo [00:20.00] dunia')).toBe('Halo dunia');
  });

  it('mengambil baris teks polos dan membuang yang kosong', () => {
    expect(parsePlainLyrics('  baris satu \n\n[00:01.00] baris dua \n   ')).toEqual([
      'baris satu',
      'baris dua',
    ]);
  });
});

describe('pencarian baris aktif', () => {
  const lyric = lines([0, 'awal'], [10_000, 'tengah'], [20_000, 'akhir']);

  it('mengembalikan -1 sebelum baris pertama', () => {
    expect(findActiveLineIndex(lyric, -1)).toBe(-1);
    expect(activeLineAt(lyric, -1)).toBeNull();
  });

  it('menandai baris terakhir yang waktunya sudah lewat', () => {
    expect(findActiveLineIndex(lyric, 0)).toBe(0);
    expect(findActiveLineIndex(lyric, 9_999)).toBe(0);
    expect(findActiveLineIndex(lyric, 10_000)).toBe(1);
    expect(activeLineAt(lyric, 15_000)?.text).toBe('tengah');
    expect(findActiveLineIndex(lyric, 999_999)).toBe(2);
  });

  it('aman untuk daftar kosong', () => {
    expect(findActiveLineIndex([], 5_000)).toBe(-1);
    expect(selectLyricWindow([], 5_000)).toEqual([]);
  });
});

describe('selectLyricWindow', () => {
  const lyric = Array.from({ length: 12 }, (_unused, index) => ({
    timeMs: index * 10_000,
    text: `baris ${index}`,
  }));

  it('jendela mengelilingi baris aktif', () => {
    const window = selectLyricWindow(lyric, 50_000, { before: 2, after: 2 });

    expect(window.map((entry) => entry.line.text)).toEqual([
      'baris 3',
      'baris 4',
      'baris 5',
      'baris 6',
      'baris 7',
    ]);
    expect(window.find((entry) => entry.active)?.line.text).toBe('baris 5');
    expect(window.filter((entry) => entry.active)).toHaveLength(1);
  });

  it('jendela mulai dari baris pertama kalau belum ada yang aktif', () => {
    const window = selectLyricWindow(lyric, -5_000, { before: 2, after: 2 });

    expect(window.map((entry) => entry.line.text)).toEqual([
      'baris 0',
      'baris 1',
      'baris 2',
      'baris 3',
      'baris 4',
    ]);
    expect(window.every((entry) => !entry.active)).toBe(true);
  });

  it('jendela tidak melewati akhir daftar', () => {
    const window = selectLyricWindow(lyric, 999_000, { before: 1, after: 1 });

    expect(window.map((entry) => entry.line.text)).toEqual(['baris 9', 'baris 10', 'baris 11']);
    expect(window.find((entry) => entry.active)?.line.text).toBe('baris 11');
  });
});

describe('formatTimecode', () => {
  it('format m:ss dan aman untuk nilai aneh', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(65_000)).toBe('1:05');
    expect(formatTimecode(3_723_000)).toBe('62:03');
    expect(formatTimecode(Number.NaN)).toBe('0:00');
  });
});

describe('pembersihan query', () => {
  it('membuang label YouTube dari judul', () => {
    expect(cleanTrackTitle('Lagu Uji (Official Music Video)')).toBe('Lagu Uji');
    expect(cleanTrackTitle('Lagu Uji [Official Lyric Video]')).toBe('Lagu Uji');
    expect(cleanTrackTitle('Lagu Uji (Lyrics) [HD] [2019]')).toBe('Lagu Uji');
    expect(cleanTrackTitle('Lagu Uji feat. Band Lain')).toBe('Lagu Uji');
    expect(cleanTrackTitle('Lagu Uji | Official Video')).toBe('Lagu Uji');
  });

  it('membuang akhiran otomatis dari nama artis', () => {
    expect(cleanArtistName('Banda Myth - Topic')).toBe('Banda Myth');
    expect(cleanArtistName('Banda MythVEVO')).toBe('Banda Myth');
    expect(cleanArtistName('  Banda   Myth  ')).toBe('Banda Myth');
  });

  it('menyusun query dari lagu yang sedang diputar', () => {
    expect(
      buildLyricsQuery({
        title: 'Lagu Uji (Official Video) [HD]',
        artist: 'Banda Myth - Topic',
        durationMs: 200_000,
      }),
    ).toEqual({ trackName: 'Lagu Uji', artistName: 'Banda Myth' });
  });

  it('kunci cache stabil dan tidak membedakan huruf besar', () => {
    const first = cacheKey({ title: 'Lagu Uji', artist: 'Banda Myth', durationMs: 1 });
    const second = cacheKey({ title: 'LAGU UJI', artist: 'banda myth', durationMs: 999 });

    expect(first).toBe(second);
  });
});

describe('pickBestCandidate', () => {
  const items = [
    { id: 1, duration: 200, instrumental: true, plainLyrics: '[Instrumental]' },
    { id: 2, duration: 199, plainLyrics: 'lirik lagian' },
    { id: 3, duration: 180, syncedLyrics: '[00:01.00]halo' },
    { id: 4, duration: 60, plainLyrics: 'versi pendek' },
  ];

  it('membuang kandidat instrumental dan memilih durasi terdekat', () => {
    expect(pickBestCandidate(items, 199_000)?.id).toBe(2);
  });

  it('memakai kandidat pertama kalau durasi tidak diketahui', () => {
    expect(pickBestCandidate(items, 0)?.id).toBe(2);
  });

  it('tetap memilih yang paling dekat walau semua meleset jauh', () => {
    expect(pickBestCandidate(items, 205_000)?.id).toBe(2);
  });

  it('mengembalikan null untuk daftar kosong atau instrumental semua', () => {
    expect(pickBestCandidate([], 1_000)).toBeNull();
    expect(pickBestCandidate([{ id: 1, instrumental: true, duration: 100 }], 1_000)).toBeNull();
  });

  it('mengenali kandidat yang punya lirik', () => {
    expect(hasLyrics({ plainLyrics: 'ada' })).toBe(true);
    expect(hasLyrics({ syncedLyrics: '   ' })).toBe(false);
    expect(firstNonEmpty('', null, 'akhir')).toBe('akhir');
    expect(firstNonEmpty(undefined)).toBeNull();
  });
});

describe('ekstrak lirik Genius', () => {
  const html = [
    '<html><body>',
    '<div data-lyrics-container="true">Baris satu<br/>Baris &amp; dua</div>',
    '<div data-lyrics-container="true"><p>Baris <b>tiga</b></p></div>',
    '<div class="bacaan">bukan lirik</div>',
    '</body></html>',
  ].join('');

  it('mengambil isi container lirik saja', () => {
    expect(extractGeniusLyrics(html)).toEqual([
      'Baris satu',
      'Baris & dua',
      'Baris tiga',
    ]);
  });

  it('mengubah entity HTML', () => {
    expect(decodeEntities('a &amp; b &#39;c&#39; &#x27;d&#39; &unknown;')).toBe(
      "a & b 'c' 'd' &unknown;",
    );
  });

  it('aman untuk HTML kosong', () => {
    expect(extractGeniusLyrics('')).toEqual([]);
  });
});

describe('toDocument', () => {
  it('mengutamakan lirik sinkron', () => {
    const document = toDocument(
      { syncedLyrics: '[00:01.00]halo', plainLyrics: 'halo polos', trackName: 'T', artistName: 'A' },
      'cadangan',
      'cadangan-artis',
    );

    expect(document?.synced).toBe(true);
    expect(document?.source).toBe('lrclib-synced');
    expect(document?.lines).toEqual([{ timeMs: 1_000, text: 'halo' }]);
    expect(document?.trackName).toBe('T');
  });

  it('jatuh ke lirik polos ketika tidak ada yang sinkron', () => {
    const document = toDocument({ plainLyrics: 'satu\ndua' }, 'T', 'A');

    expect(document?.synced).toBe(false);
    expect(document?.source).toBe('lrclib-plain');
    expect(document?.lines).toEqual([
      { timeMs: 0, text: 'satu' },
      { timeMs: 0, text: 'dua' },
    ]);
    expect(document?.trackName).toBe('T');
    expect(document?.artistName).toBe('A');
  });

  it('null kalau tidak ada lirik sama sekali', () => {
    expect(toDocument({ plainLyrics: '   ' }, 'T', 'A')).toBeNull();
    expect(toDocument(null, 'T', 'A')).toBeNull();
  });
});

/** HTTP palsu:reply sesuai pola URL; yang tidak dikenali dianggap 404. */
function createHttp(
  routes: Array<[string, Partial<LyricsHttpResponse> | Error]>,
  calls: string[] = [],
): LyricsHttpGet {
  return async (url: string) => {
    calls.push(url);

    for (const [pattern, response] of routes) {
      if (!url.includes(pattern)) continue;
      if (response instanceof Error) throw response;
      return { ok: true, status: 200, body: null, ...response };
    }

    return { ok: false, status: 404, body: null };
  };
}

const query = { title: 'Lagu Uji', artist: 'Banda Myth', durationMs: 200_000 };

describe('LyricsService dengan LRCLIB', () => {
  it('memakai pencarian langsung dan meng-cache hasilnya', async () => {
    const calls: string[] = [];
    const service = new LyricsService({
      httpGet: createHttp(
        [['get?artist_name=', { body: { syncedLyrics: SYNCED_LRC, plainLyrics: ' polos' } }]],
        calls,
      ),
    });

    const first = await service.lookup(query);
    const second = await service.lookup({ ...query, durationMs: 999_000 });

    expect(first.kind).toBe('found');
    expect(first.kind === 'found' && first.document.source).toBe('lrclib-synced');
    expect(first.kind === 'found' && first.document.lines[0]).toEqual({
      timeMs: 1_000,
      text: 'Baris pertama',
    });
    expect(second.kind).toBe('found');
    expect(calls).toHaveLength(1);
    expect(service.cacheSize).toBe(1);
  });

  it('jatuh ke /search lalu ambil detail per id', async () => {
    const calls: string[] = [];
    const service = new LyricsService({
      httpGet: createHttp(
        [
          ['/get/42', { body: { id: 42, plainLyrics: 'lirik detail', trackName: 'T', artistName: 'A' } }],
          ['search?', { body: [{ id: 42, duration: 200, plainLyrics: null }] }],
        ],
        calls,
      ),
    });

    const result = await service.lookup(query);

    expect(result.kind === 'found' && result.document.lines).toEqual([
      { timeMs: 0, text: 'lirik detail' },
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('/get?artist_name=');
    expect(calls[1]).toContain('/search?');
    expect(calls[2]).toContain('/get/42');
  });

  it('memakai lirik yang sudah ikut di respons /search', async () => {
    const calls: string[] = [];
    const service = new LyricsService({
      httpGet: createHttp(
        [['search?', { body: [{ id: 7, duration: 200, syncedLyrics: '[00:02.00]halo' }] }]],
        calls,
      ),
    });

    const result = await service.lookup(query);

    expect(result.kind === 'found' && result.document.synced).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('baca durasi (detik) pada query langsung', async () => {
    const calls: string[] = [];
    const service = new LyricsService({ httpGet: createHttp([], calls) });

    await service.lookup(query);

    expect(calls[0]).toContain('duration=200');
  });

  it('hanya pakai /search kalau artis tidak diketahui', async () => {
    const calls: string[] = [];
    const service = new LyricsService({
      httpGet: createHttp([['search?', { body: [] }]], calls),
    });

    const result = await service.lookup({ title: 'Lagu Uji', artist: '', durationMs: 0 });

    expect(result.kind).toBe('not-found');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('q=Lagu+Uji');
  });

  it('balik not-found kalau sumber tidak punya lirik', async () => {
    const calls: string[] = [];
    const service = new LyricsService({ httpGet: createHttp([], calls) });

    const result = await service.lookup(query);

    expect(result.kind).toBe('not-found');
    expect(result.kind === 'not-found' && result.message).toContain('/lyrics');
  });

  it('balik error kalau sumber error atau jaringan putus', async () => {
    const serverError = new LyricsService({
      httpGet: createHttp([
        ['get?artist_name=', { ok: false, status: 503 }],
        ['search?', { ok: false, status: 503 }],
      ]),
    });
    const broken = new LyricsService({
      httpGet: createHttp([['get?artist_name=', new Error('ECONNREFUSED')]]),
    });

    expect((await serverError.lookup(query)).kind).toBe('error');
    expect((await broken.lookup(query)).kind).toBe('error');
  });

  it('judul kosong tidak pernah memanggil jaringan', async () => {
    const calls: string[] = [];
    const service = new LyricsService({ httpGet: createHttp([], calls) });

    const result = await service.lookup({ title: '   ', artist: 'Banda Myth', durationMs: 0 });

    expect(result.kind).toBe('not-found');
    expect(calls).toHaveLength(0);
  });

  it('cache kedaluwarsa memanggil sumber lagi', async () => {
    const calls: string[] = [];
    let now = 1_000_000;
    const service = new LyricsService({
      httpGet: createHttp([['get?artist_name=', { body: { plainLyrics: 'lirik' } }]], calls),
      now: () => now,
      cacheTtlMs: 5_000,
    });

    await service.lookup(query);
    now += 1_000;
    await service.lookup(query);
    expect(calls).toHaveLength(1);

    now += 10_000;
    await service.lookup(query);
    expect(calls).toHaveLength(2);

    service.clearCache();
    expect(service.cacheSize).toBe(0);
  });
});

describe('LyricsService dengan cadangan Genius', () => {
  const geniusRoutes: Array<[string, Partial<LyricsHttpResponse> | Error]> = [
    [
      'api.genius.com/search',
      { body: { response: { hits: [{ result: { id: 99, title: 'Lagu Uji' } }] } } },
    ],
    [
      'api.genius.com/songs/99',
      { body: { response: { song: { url: 'https://genius.com/Lagu-uji-lyrics' } } } },
    ],
    [
      'genius.com/Lagu-uji-lyrics',
      { body: '<div data-lyrics-container="true">satu<br/>dua</div>' },
    ],
  ];

  it('dipakai hanya kalau LRCLIB tidak punya lirik', async () => {
    const calls: string[] = [];
    const service = new LyricsService({
      geniusToken: 'token-abc',
      httpGet: createHttp(geniusRoutes, calls),
    });

    const result = await service.lookup(query);

    expect(result.kind === 'found' && result.document.source).toBe('genius');
    expect(result.kind === 'found' && result.document.lines).toEqual([
      { timeMs: 0, text: 'satu' },
      { timeMs: 0, text: 'dua' },
    ]);
    expect(calls.some((url) => url.includes('api.genius.com'))).toBe(true);
    expect(service.hasGeniusFallback).toBe(true);
  });

  it('tidak dipakai kalau LRCLIB sudah berhasil', async () => {
    const calls: string[] = [];
    const service = new LyricsService({
      geniusToken: 'token-abc',
      httpGet: createHttp(
        [
          ...geniusRoutes,
          ['get?artist_name=', { body: { plainLyrics: 'dari lrclib' } }],
        ],
        calls,
      ),
    });

    const result = await service.lookup(query);

    expect(result.kind === 'found' && result.document.source).toBe('lrclib-plain');
    expect(calls.some((url) => url.includes('api.genius.com'))).toBe(false);
  });

  it('tanpa token, Genius tidak pernah dipanggil', async () => {
    const calls: string[] = [];
    const service = new LyricsService({ httpGet: createHttp(geniusRoutes, calls) });

    const result = await service.lookup(query);

    expect(result.kind).toBe('not-found');
    expect(service.hasGeniusFallback).toBe(false);
    expect(calls.every((url) => !url.includes('api.genius.com'))).toBe(true);
  });

  it('status 429 dari Genius tetap jadi not-found, bukan error fatal', async () => {
    const calls: string[] = [];
    const service = new LyricsService({
      geniusToken: 'token-abc',
      httpGet: createHttp(
        [['api.genius.com/search', { ok: false, status: 429 }]],
        calls,
      ),
    });

    expect((await service.lookup(query)).kind).toBe('not-found');
  });
});

describe('lyricsEmbed', () => {
  const document = {
    lines: Array.from({ length: 30 }, (_unused, index) => ({
      timeMs: index * 10_000,
      text: `baris ${index}`,
    })),
    synced: true,
    source: 'lrclib-synced' as const,
    trackName: 'Lagu Uji',
    artistName: 'Banda Myth',
  };

  it('lirik sinkron menandai baris yang sedang aktif', () => {
    const json = lyricsEmbed({ document, positionMs: 105_000, uri: 'https://youtu.be/x' }).toJSON();

    expect(json.title).toBe('🎤 Lagu Uji — Banda Myth');
    expect(json.url).toBe('https://youtu.be/x');
    expect(json.description).toContain('▶ **baris 10**');
    expect(json.description).toContain('`1:50` baris 11');
    expect(json.description).not.toContain('baris 20');
    expect(json.fields?.[0]?.value).toBe('`1:45`');
  });

  it('lirik polos ditampilkan dari atas dan dipotong', () => {
    const plain = { ...document, synced: false, source: 'lrclib-plain' as const };
    const json = lyricsEmbed({ document: plain, positionMs: 105_000 }).toJSON();

    expect(json.description).toContain('baris 0');
    expect(json.description).not.toContain('baris 20');
    expect(json.fields).toBeUndefined();
    expect(json.footer?.text).toContain('30 baris');
  });

  it('tanpa posisi tetap menampilkan potongan awal untuk lirik sinkron', () => {
    const json = lyricsEmbed({ document, positionMs: null }).toJSON();

    expect(json.description).toContain('baris 0');
    expect(json.description).not.toContain('▶');
  });

  it('judul tanpa artis tidak memaksa tanda hubung', () => {
    const noArtist = { ...document, artistName: '' };
    expect(lyricsEmbed({ document: noArtist }).toJSON().title).toBe('🎤 Lagu Uji');
  });

  it('lirik pendek tidak menambah catatan baris', () => {
    const short = { ...document, lines: document.lines.slice(0, 2) };
    const json = lyricsEmbed({ document: short }).toJSON();

    expect(json.footer?.text).not.toContain('dipotong');
    expect(json.footer?.text).toContain('/lyrics <judul>');
  });

  it('batas baris polos mengikuti LYRICS_PLAIN_LINES', () => {
    expect(LYRICS_PLAIN_LINES).toBe(20);
  });
});