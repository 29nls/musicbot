import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  binaryFileName,
  cacheBinaryPath,
  downloadYtDlpBinary,
  LATEST_RELEASE_API,
  pickReleaseAssetUrl,
  resolveYtDlpBinary,
} from '../src/modules/music/stream/binary.js';
import { COOKIE_STAGING_SUFFIX, cookieArgs, stageCookieFile, stagedCookiePath } from '../src/modules/music/stream/cookies.js';
import {
  classifyStreamFailure,
  isAgeRestrictedError,
  isBotDetectionError,
  isTransientError,
  parseHttpStatusCode,
  StreamError,
  toStreamError,
} from '../src/modules/music/stream/errors.js';
import { FFMPEG_FILTER_ARGS, ffmpegArgs, OPUS_FRAME_SIZE } from '../src/modules/music/stream/ffmpegArgs.js';
import {
  buildMetadataArgs,
  buildStreamArgs,
  LIVE_FORMAT,
  parseEntries,
  searchInput,
  STREAM_FORMAT,
  toYtDlpEntry,
} from '../src/modules/music/stream/ytDlp.js';
import { FILTER_MODES } from '../src/modules/music/filters.js';
import {
  ensureStreamRuntime,
  missingBinaryMessage,
  resolveStreamRuntime,
} from '../src/modules/music/stream/runtime.js';

describe('ffmpegArgs', () => {
  it('selalu menghasilkan PCM 48 kHz stereo tanpa video', () => {
    const args = ffmpegArgs();

    expect(args).toContain('-vn');
    expect(args.slice(args.indexOf('-ar'), args.indexOf('-ar') + 2)).toEqual(['-ar', '48000']);
    expect(args.slice(args.indexOf('-ac'), args.indexOf('-ac') + 2)).toEqual(['-ac', '2']);
    expect(args.slice(args.indexOf('-f'), args.indexOf('-f') + 2)).toEqual(['-f', 's16le']);
    expect(args).toContain('pcm_s16le');
  });

  it('tidak mengandalkan opus dari ffmpeg — batas packet Discord 1.275 byte', () => {
    // Diperiksa di mesin ini: keluaran opus ffmpeg mentah rata-rata 11.686 byte per
    // paket, jadi akan dibuang Discord. Yang dipakai: PCM + encoder opus 20 ms.
    const args = ffmpegArgs();

    expect(args).not.toContain('opus');
    expect(args).not.toContain('libopus');
  });

  it('baca dari stdin ketika tidak ada berkas lokal', () => {
    const args = ffmpegArgs();

    expect(args.slice(0, 5)).toEqual(['-loglevel', '0', '-i', '-', '-vn']);
    expect(args).not.toContain('-ss');
  });

  it('taruh -ss setelah -i supaya pindah posisi akurat', () => {
    const args = ffmpegArgs({ seekSeconds: 42, inputPath: '/tmp/lagu.tmp' });

    const inputIndex = args.indexOf('-i');
    const seekIndex = args.indexOf('-ss');

    expect(args[inputIndex + 1]).toBe('/tmp/lagu.tmp');
    expect(seekIndex).toBeGreaterThan(inputIndex);
    expect(args[seekIndex + 1]).toBe('42');
  });

  it('tidak menaruh -ss untuk pemutaran dari awal', () => {
    expect(ffmpegArgs({ inputPath: '/tmp/lagu.tmp' })).not.toContain('-ss');
  });

  it('mode off tidak menambah -af sama sekali', () => {
    expect(ffmpegArgs({ filterMode: 'off' })).not.toContain('-af');
  });

  it('setiap mode filter punya tepat satu filter ffmpeg', () => {
    for (const mode of FILTER_MODES) {
      const args = ffmpegArgs({ filterMode: mode });
      const filterCount = args.filter((arg) => arg === '-af').length;

      if (mode === 'off') {
        expect(filterCount).toBe(0);
      } else {
        expect(filterCount).toBe(1);
        expect(args[args.indexOf('-af') + 1]).toBe(FFMPEG_FILTER_ARGS[mode as '8d']);
      }
    }
  });

  it('filter nightcore dan vaporwave tidak mungkin sama', () => {
    expect(FFMPEG_FILTER_ARGS.nightcore).not.toBe(FFMPEG_FILTER_ARGS.vaporwave);
  });

  it('ffmpeg dalam mode diam supaya errornya dibaca sendiri', () => {
    expect(ffmpegArgs()[0]).toBe('-loglevel');
    expect(ffmpegArgs()[1]).toBe('0');
  });

  it('ukuran frame opus 20 ms sesuai 960 sampel pada 48 kHz', () => {
    expect(OPUS_FRAME_SIZE).toBe(960);
    expect(OPUS_FRAME_SIZE / 48_000).toBeCloseTo(0.02, 5);
  });
});

describe('buildStreamArgs', () => {
  it('mengirim audio ke stdout dan mempick format audio', () => {
    const args = buildStreamArgs('https://youtu.be/abc');

    expect(args[args.indexOf('-o') + 1]).toBe('-');
    expect(args[args.indexOf('-f') + 1]).toBe(STREAM_FORMAT);
  });

  it('URL selalu di akhir — yt-dlp memperlakukannya sebagai input', () => {
    const args = buildStreamArgs('https://youtu.be/abc', { cookiePath: '/tmp/c.tmp' });

    expect(args[args.length - 1]).toBe('https://youtu.be/abc');
  });

  it('menonaktifkan file konfigurasi yt-dlp milik server', () => {
    expect(buildStreamArgs('x')).toContain('--no-config');
  });

  it('menyebutkan Node sebagai runtime JavaScript untuk YouTube', () => {
    const args = buildStreamArgs('x');

    expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node');
    expect(buildMetadataArgs('x')).toContain('--js-runtimes');
  });

  it('format siaran langsung berbeda dan mulai dari awal', () => {
    const args = buildStreamArgs('https://youtu.be/live', { isLive: true });

    expect(args[args.indexOf('-f') + 1]).toBe(LIVE_FORMAT);
    expect(args).toContain('--no-live-from-start');
  });

  it('tidak mengirim flag live untuk lagu biasa', () => {
    expect(buildStreamArgs('https://youtu.be/abc')).not.toContain('--no-live-from-start');
  });

  it('cookie hanya ikut kalau benar-benar ada', () => {
    expect(buildStreamArgs('x', { cookiePath: null })).not.toContain('--cookies');
    expect(buildStreamArgs('x', { cookiePath: '/tmp/c.tmp' })).toContain('--cookies');
  });

  it('extractor args ikut diteruskan untuk kasus tertentu', () => {
    const args = buildStreamArgs('x', { extractorArgs: 'youtube:player_client=web' });

    expect(args[args.indexOf('--extractor-args') + 1]).toBe('youtube:player_client=web');
  });
});

describe('buildMetadataArgs', () => {
  it('meminta JSON satu entri tanpa playlist', () => {
    const args = buildMetadataArgs('ytsearch5:halo');

    expect(args).toContain('-J');
    expect(args).toContain('--no-playlist');
    expect(args[args.length - 1]).toBe('ytsearch5:halo');
  });
});

describe('searchInput', () => {
  it('membentuk input pencarian yt-dlp', () => {
    expect(searchInput('halo', 5)).toBe('ytsearch5:halo');
  });

  it('minimal satu hasil walau angka kacau', () => {
    expect(searchInput('halo', 0)).toBe('ytsearch1:halo');
    expect(searchInput('halo', -3)).toBe('ytsearch1:halo');
  });
});

describe('toYtDlpEntry', () => {
  const raw = {
    id: 'wsEkktRGZ18',
    title: 'Lagu Uji',
    uploader: 'Kanal Uji',
    duration: 213,
    webpage_url: 'https://www.youtube.com/watch?v=wsEkktRGZ18',
    thumbnail: 'https://img.example/cover.jpg',
    vcodec: 'none',
  };

  it('mengubah JSON yt-dlp ke bentuk internal', () => {
    const entry = toYtDlpEntry(raw);

    expect(entry).toEqual({
      id: 'wsEkktRGZ18',
      title: 'Lagu Uji',
      uploader: 'Kanal Uji',
      durationMs: 213_000,
      url: 'https://www.youtube.com/watch?v=wsEkktRGZ18',
      thumbnail: 'https://img.example/cover.jpg',
      isLive: false,
      isVideo: false,
    });
  });

  it('siaran langsung selalu berawal dengan durasi nol', () => {
    const entry = toYtDlpEntry({ ...raw, live_status: 1, duration: 12_345 });

    expect(entry?.isLive).toBe(true);
    expect(entry?.durationMs).toBe(0);
  });

  it('menolak entri tanpa id atau tanpa URL', () => {
    expect(toYtDlpEntry({ title: 'tanpa id' })).toBeNull();
    expect(toYtDlpEntry({ id: 'abc' })).toBeNull();
    expect(toYtDlpEntry(null)).toBeNull();
    expect(toYtDlpEntry('bukan objek')).toBeNull();
  });

  it('jatuh ke nama kanal yang paling logis saat uploader kosong', () => {
    expect(toYtDlpEntry({ ...raw, uploader: undefined, channel: 'Kanal Cadangan' })?.uploader).toBe(
      'Kanal Cadangan',
    );
    expect(toYtDlpEntry({ ...raw, uploader: undefined, channel: undefined })?.uploader).toBe(
      'Tidak diketahui',
    );
  });
});

describe('parseEntries', () => {
  it('membaca daftar hasil pencarian dari "entries"', () => {
    const entries = parseEntries({
      entries: [
        { id: 'a', webpage_url: 'https://youtu.be/a', title: 'Satu', duration: 10 },
        { id: 'b', webpage_url: 'https://youtu.be/b', title: 'Dua', duration: 20 },
      ],
    });

    expect(entries.map((entry) => entry.title)).toEqual(['Satu', 'Dua']);
  });

  it('membaca satu video tunggal tanpa "entries"', () => {
    const entries = parseEntries({ id: 'a', webpage_url: 'https://youtu.be/a', title: 'Satu' });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('Satu');
  });

  it('membuang entri rusak tanpa menggagalkan yang lain', () => {
    const entries = parseEntries({
      entries: [{ id: 'a', webpage_url: 'https://youtu.be/a' }, { title: 'rusak' }],
    });

    expect(entries).toHaveLength(1);
  });

  it('mengembalikan daftar kosong untuk masukan yang bukan JSON hasil yt-dlp', () => {
    expect(parseEntries(null)).toEqual([]);
    expect(parseEntries('teks')).toEqual([]);
  });
});

describe('klasifikasi galat streaming', () => {
  it('mengenali permintaan login YouTube sebagai deteksi bot', () => {
    expect(isBotDetectionError("Sign in to confirm you're not a bot")).toBe(true);
    expect(isBotDetectionError('ERROR: Unable to download: HTTP Error 429: Too Many Requests')).toBe(true);
    expect(classifyStreamFailure('please sign in to view')).toBe('bot-detection');
  });

  it('429 dianggap rate limit, bukan masalah cookie', () => {
    // Ke-divergensi dari rawon: saran "perbarui cookie" salah untuk rate limit.
    expect(classifyStreamFailure('ERROR: Unable to download: HTTP Error 429: Too Many Requests')).toBe(
      'transient',
    );
    expect(classifyStreamFailure('The uploader has been rate-limited')).toBe('transient');
  });

  it('tidak salah klasikan video umur terbatas sebagai deteksi bot', () => {
    const message = 'ERROR: age-restricted video. Sign in to confirm your age';

    expect(isBotDetectionError(message)).toBe(false);
    expect(isAgeRestrictedError(message)).toBe(true);
    expect(classifyStreamFailure(message)).toBe('age-restricted');
  });

  it('mengenali gangguan sesaat yang layak diulang', () => {
    expect(isTransientError('HTTP Error 429: Too Many Requests')).toBe(true);
    expect(isTransientError('read ECONNRESET')).toBe(true);
    expect(classifyStreamFailure('Unable to download webpage: <urlopen error timed out>')).toBe(
      'transient',
    );
  });

  it('mengenali tautan media yang sudah kedaluwarsa', () => {
    expect(classifyStreamFailure('HTTP Error 403: Forbidden for https://cdn.example/x.m4a')).toBe(
      'expired-media',
    );
  });

  it('mengenali video yang memang tidak bisa diputar', () => {
    expect(classifyStreamFailure('ERROR: Video unavailable')).toBe('unavailable');
    expect(classifyStreamFailure('ERROR: Private video. Sign in if you have been granted access')).toBe(
      'unavailable',
    );
  });

  it('galat asing tetap unknown, bukan dipaksa jadi kategori lain', () => {
    expect(classifyStreamFailure('ERROR: Unrecognized URL type: https://contoh.test/a')).toBe('unknown');
  });

  it('membaca status HTTP dari pesan galat', () => {
    expect(parseHttpStatusCode('HTTP Error 404: Not Found')).toBe(404);
    expect(parseHttpStatusCode('HTTP Error 503: Service Unavailable')).toBe(503);
    expect(parseHttpStatusCode('https://contoh.test/a tidak memuat status')).toBeNull();
  });

  it('StreamError menandai apa yang boleh diulang dan apa yang butuh cookie', () => {
    const transient = toStreamError('HTTP Error 429: Too Many Requests', 'https://youtu.be/a');
    expect(transient).toBeInstanceOf(StreamError);
    expect(transient.retryable).toBe(true);
    expect(transient.needsCookies).toBe(false);
    expect(transient.url).toBe('https://youtu.be/a');

    const botCheck = toStreamError("Sign in to confirm you're not a bot");
    expect(botCheck.needsCookies).toBe(true);
    expect(botCheck.retryable).toBe(false);

    expect(toStreamError('   ').message).toBe('Gagal mengambil audio tanpa keterangan');
  });
});

describe('penyiapan cookie', () => {
  it('menyalin cookie ke berkas terpisah, bukan menulisi aslinya', () => {
    const copies: Array<[string, string]> = [];
    const staged = stageCookieFile('/data/cookies.txt', {
      isFile: () => true,
      copyFile: (from, to) => copies.push([from, to]),
    });

    expect(copies).toEqual([['/data/cookies.txt', `/data/cookies.txt${COOKIE_STAGING_SUFFIX}`]]);
    expect(staged).toBe(`/data/cookies.txt${COOKIE_STAGING_SUFFIX}`);
  });

  it('langsung dipakai apa adanya kalau cookie tidak ada', () => {
    expect(stageCookieFile('/data/tidak-ada.txt', { isFile: () => false })).toBeNull();
    expect(stageCookieFile(null)).toBeNull();
    expect(stageCookieFile('   ')).toBeNull();
  });

  it('jatuh ke berkas asli kalau penyalinan gagal', () => {
    const staged = stageCookieFile('/data/cookies.txt', {
      isFile: () => true,
      copyFile: () => {
        throw new Error('EACCES');
      },
    });

    expect(staged).toBe('/data/cookies.txt');
  });

  it('lokasi salinan bisa dihitung tanpa menyentuh disk', () => {
    expect(stagedCookiePath('/data/cookies.txt')).toBe(`/data/cookies.txt${COOKIE_STAGING_SUFFIX}`);
  });

  it('argumen --cookies hanya ada kalau ada salinan', () => {
    expect(cookieArgs(null)).toEqual([]);
    expect(cookieArgs('/tmp/c.tmp')).toEqual(['--cookies', '/tmp/c.tmp']);
  });
});

describe('penemuan biner yt-dlp', () => {
  it('nama berkas mengikuti platform', () => {
    expect(binaryFileName('win32')).toBe('yt-dlp.exe');
    expect(binaryFileName('darwin')).toBe('yt-dlp_macos');
    expect(binaryFileName('linux')).toBe('yt-dlp');
  });

  it('YTDLP_PATH menang dan tidak jatuh ke lokasi lain', () => {
    const resolved = resolveYtDlpBinary({
      envPath: 'C:/tools/yt-dlp.exe',
      cacheDir: '/app/cache',
      isFile: () => true,
      which: () => '/usr/bin/yt-dlp',
      platform: 'win32',
    });

    expect(resolved).toEqual({ path: 'C:/tools/yt-dlp.exe', source: 'env' });
  });

  it('YTDLP_PATH kosong dihitung sama dengan tidak diisi', () => {
    const resolved = resolveYtDlpBinary({
      envPath: '   ',
      cacheDir: '/app/cache',
      isFile: () => false,
      which: () => null,
      platform: 'linux',
    });

    expect(resolved).toEqual({ source: 'missing' });
  });

  it('memakai biner cache sebelum PATH', () => {
    const cached = cacheBinaryPath('/app/cache', 'linux');

    const resolved = resolveYtDlpBinary({
      cacheDir: '/app/cache',
      isFile: (candidate) => candidate === cached,
      which: () => '/usr/bin/yt-dlp',
      platform: 'linux',
    });

    expect(resolved).toEqual({ path: cached, source: 'cache' });
  });

  it('jatuh ke PATH kalau tidak ada cache', () => {
    const resolved = resolveYtDlpBinary({
      cacheDir: '/app/cache',
      isFile: () => false,
      which: () => '/usr/local/bin/yt-dlp',
      platform: 'linux',
    });

    expect(resolved).toEqual({ path: '/usr/local/bin/yt-dlp', source: 'path' });
  });

  it('melaporkan tidak ada biner dengan jujur', () => {
    expect(resolveYtDlpBinary({ cacheDir: '/app/cache', isFile: () => false })).toEqual({
      source: 'missing',
    });
  });

  it('memilih aset rilis yang cocok dengan platform', () => {
    const releases = [
      { assets: [{ name: 'yt-dlp.exe', browser_download_url: 'https://r/win' }, { name: 'yt-dlp', browser_download_url: 'https://r/lin' }] },
    ];

    expect(pickReleaseAssetUrl(releases, 'win32')).toBe('https://r/win');
    expect(pickReleaseAssetUrl(releases, 'linux')).toBe('https://r/lin');
    expect(pickReleaseAssetUrl(releases, 'darwin')).toBeNull();
    expect(pickReleaseAssetUrl('bukan json', 'linux')).toBeNull();
  });

  it('menulis biner ke cache dengan mode yang benar untuk platform', async () => {
    const writes: Array<{ target: string; mode: number }> = [];
    const created: string[] = [];
    const expectedTarget = cacheBinaryPath('/app/cache', 'linux');

    const target = await downloadYtDlpBinary('/app/cache', {
      platform: 'linux',
      fetchJson: async (url) => {
        expect(url).toBe(LATEST_RELEASE_API);
        return [{ assets: [{ name: 'yt-dlp', browser_download_url: 'https://r/lin' }] }];
      },
      fetchBinary: async () => new Uint8Array([1, 2, 3]),
      writeFile: (path, _data, mode) => writes.push({ target: path, mode }),
      mkdir: (dir) => created.push(dir),
    });

    expect(target).toBe(expectedTarget);
    expect(writes).toEqual([{ target: expectedTarget, mode: 0o755 }]);
    expect(created).toContain(join('/app/cache', 'scripts'));
  });

  it('menolak mengarang nama aset yang tidak ada di rilis', async () => {
    await expect(
      downloadYtDlpBinary('/app/cache', {
        platform: 'darwin',
        fetchJson: async () => [{ assets: [{ name: 'yt-dlp', browser_download_url: 'u' }] }],
      }),
    ).rejects.toThrow(/tidak punya aset/);
  });
});

describe('runtime streaming dari environment', () => {
  it('menghormati YTDLP_PATH, FFMPEG_PATH, dan cookie', () => {
    const runtime = resolveStreamRuntime(
      {
        YTDLP_PATH: '/opt/bin/yt-dlp',
        FFMPEG_PATH: '/opt/bin/ffmpeg',
        YTDLP_COOKIES_FILE: '/data/cookies.txt',
      },
      {
        cacheDir: '/app/cache',
        isFile: (candidate) => candidate === '/data/cookies.txt',
        copyFile: () => undefined,
        which: () => '/usr/bin/yt-dlp',
      },
    );

    expect(runtime.binary).toEqual({ path: '/opt/bin/yt-dlp', source: 'env' });
    expect(runtime.ffmpegPath).toBe('/opt/bin/ffmpeg');
    expect(runtime.cookieSource).toBe('/data/cookies.txt');
    expect(runtime.cookiePath).toBe(`/data/cookies.txt${COOKIE_STAGING_SUFFIX}`);
  });

  it('tanpa environment pun tetap jalan — biner dari cache, tanpa cookie', () => {
    const cached = cacheBinaryPath('/app/cache', process.platform);

    const runtime = resolveStreamRuntime(
      {},
      {
        cacheDir: '/app/cache',
        isFile: (candidate) => candidate === cached,
        which: () => null,
      },
    );

    expect(runtime.binary).toEqual({ path: cached, source: 'cache' });
    expect(runtime.cookiePath).toBeNull();
    expect(runtime.cookieSource).toBeNull();
    expect(runtime.ffmpegPath).toBeNull();
  });

  it('cookie yang file-nya hilang diabaikan diam-diam', () => {
    const runtime = resolveStreamRuntime(
      { YTDLP_COOKIES_FILE: '/data/tidak-ada.txt' },
      { cacheDir: '/app/cache', isFile: () => false, which: () => null },
    );

    expect(runtime.cookieSource).toBe('/data/tidak-ada.txt');
    expect(runtime.cookiePath).toBeNull();
  });

  it('tidak mengunduh apa pun kalau biner sudah ada', async () => {
    let downloadCalls = 0;

    const runtime = await ensureStreamRuntime(
      { YTDLP_PATH: '/opt/bin/yt-dlp' },
      {
        cacheDir: '/app/cache',
        download: async () => {
          downloadCalls += 1;
          return '/tidak/terpakai';
        },
      },
    );

    expect(downloadCalls).toBe(0);
    expect(runtime.binary).toEqual({ path: '/opt/bin/yt-dlp', source: 'env' });
  });

  it('mengunduh biner saat belum ada, lalu memakainya', async () => {
    const logs: string[] = [];
    const cached = cacheBinaryPath('/app/cache', process.platform);
    let existing = false;

    const runtime = await ensureStreamRuntime(
      {},
      {
        cacheDir: '/app/cache',
        isFile: () => existing,
        which: () => null,
        onLog: (message) => logs.push(message),
        download: async () => {
          existing = true;
          return cached;
        },
      },
    );

    expect(runtime.binary).toEqual({ path: cached, source: 'cache' });
    expect(logs.join(' ')).toContain('mengunduh');
  });

  it('gagal unduh tidak mematikan proses — tetap melaporkan biner hilang', async () => {
    const runtime = await ensureStreamRuntime(
      {},
      {
        cacheDir: '/app/cache',
        isFile: () => false,
        which: () => null,
        download: async () => {
          throw new Error('jaringan mati');
        },
      },
    );

    expect(runtime.binary).toEqual({ source: 'missing' });
    expect(missingBinaryMessage('/app/cache')).toContain(cacheBinaryPath('/app/cache', process.platform));
    expect(missingBinaryMessage('/app/cache')).toContain('YTDLP_PATH');
  });
});
