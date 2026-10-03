import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  addedToQueueEmbed,
  buildQueuePage,
  filterModeHint,
  filterModeLabel,
  loopModeHint,
  loopModeLabel,
  nowPlayingEmbed,
  queueEmbed,
  queueNavRow,
  renderPlayOutcome,
  searchResultsEmbed,
  seekErrorMessage,
  trackLimitReason,
  trackLimitRejectionMessage,
} from '../src/modules/music/index.js';
import { translator } from '../src/modules/i18n/index.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';
import type { QueueSnapshot, TrackInfo } from '../src/modules/music/types.js';

const id = translator('id');
const en = translator('en');

const GUILD_ID = '123456789012345678';

function track(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'encoded-1',
    title: 'Track One',
    author: 'Artist One',
    durationMs: 210_000,
    uri: 'https://example.com/1',
    artworkUrl: null,
    isStream: false,
    requesterId: GUILD_ID,
    ...overrides,
  };
}

function snapshot(count = 0, current: TrackInfo | null = null): QueueSnapshot {
  const upcoming = Array.from({ length: count }, (_, index) =>
    track({ encoded: `e-${index}`, title: `Track ${index}` }),
  );

  return {
    guildId: GUILD_ID,
    current,
    upcoming,
    upcomingDurationMs: upcoming.reduce((total, item) => total + item.durationMs, 0),
    paused: false,
    positionMs: 30_000,
    volume: 100,
    idleRemainingMs: null,
    loopMode: 'off',
    filterMode: 'off',
  };
}

/**
 * Bentuk subset `EmbedBuilder.toJSON()` yang dipakai di sini.
 *
 * Field Discord punya banyak bentuk berbeda, jadi hanya empat yang dibaca:
 * teks yang benar-benar sampai ke pengguna.
 */
interface EmbedData {
  title?: string;
  description?: string;
  footer?: { text?: string };
  fields?: Array<{ name?: string; value?: string }>;
}

/**
 * Seluruh teks embed apa adanya, supaya tidak ada bagian yang lolos dari cek.
 *
 * Embed Discord punya empat tempat teks: title, description, footer,
 * dan tiap field. Mengambil semuanya sebagai satu string membuat pengujiannya
 * tidak rapuh terhadap perubahan urutan field.
 */
function embedText(embed: EmbedBuilder): string {
  const data = embed.toJSON() as EmbedData;
  const parts: string[] = [];

  for (const key of ['title', 'description', 'footer'] as const) {
    const value = data[key];
    if (typeof value === 'string') parts.push(value);
    else if (value && typeof value === 'object' && 'text' in value) {
      parts.push(String((value as { text: unknown }).text));
    }
  }

  for (const field of data.fields ?? []) {
    parts.push(String(field.name ?? ''), String(field.value ?? ''));
  }

  return parts.join('\n');
}

/**
 * Kata yang hanya muncul dalam teks Indonesia.
 *
 * Dipakai untuk memastikan keluaran bahasa Inggris benar-benar terpisah dari
 * teks Indonesia, bukan hanya berbeda di beberapa tempat.
 */
const INDONESIAN_MARKERS = [
  'Antrian',
  'Antrean',
  'lagu',
  'Lagu',
  'Dijeda',
  'diputar',
  'Sedang',
  'Berikutnya',
  'Tidak',
  'dalam',
  'halaman',
  'Pemutaran',
];

describe('embed musik dalam bahasa Inggris', () => {
  it('nowPlaying memakai nama field, footer, dan label mode bahasa Inggris', () => {
    const current = track();
    const data = snapshot(3, current);
    data.loopMode = 'queue';
    data.filterMode = 'nightcore';

    const text = embedText(nowPlayingEmbed(current, data, en));

    expect(text).toContain('Artist');
    expect(text).toContain('Requested by');
    expect(text).toContain('Playing since');
    expect(text).toContain('3 tracks');
    expect(text).toContain('Repeat queue');
    expect(text).toContain('Nightcore');

    for (const marker of INDONESIAN_MARKERS) {
      expect(text).not.toContain(marker);
    }
  });

  it('kalimat bagian bawah "keluar otomatis" ikut diterjemahkan', () => {
    const current = track();
    const data = snapshot(0, current);
    data.idleRemainingMs = 300_000;

    expect(embedText(nowPlayingEmbed(current, data, en))).toContain('Leaving automatically in 5:00');
  });

  it('embed antrean menyebut nomor halaman dan memakai "tracks"', () => {
    const data = snapshot(25);
    const page = buildQueuePage(data.upcoming, 3);
    const text = embedText(queueEmbed(data, page, en));

    expect(text).toContain('Up next (page 3/3)');
    expect(text).toContain('5 tracks');
    expect(text).toContain('use the buttons to browse');
    expect(text).not.toContain('Berikutnya');
    expect(text).not.toContain('lagu');
  });

  it('embed antrean kosong berbahasa Inggris, bukan teks Indonesia', () => {
    const text = embedText(queueEmbed(snapshot(0), undefined, en));

    expect(text).toContain('Up next');
    expect(text).toContain('queue is empty');
    expect(text).not.toContain('antrean kosong');
  });

  it('embed /play yang ditolak diterjemahkan, termasuk alasannya', () => {
    const embed = addedToQueueEmbed(
      {
        kind: 'added',
        tracks: [track()],
        started: false,
        position: 3,
        skipped: 1,
        rejectedNeedsControl: 2,
      },
      en,
    );
    const text = embedText(embed);

    expect(text).toContain('Added to the queue (position **#3**)');
    expect(text).toContain('1** tracks were not added');
    expect(text).toContain('2** tracks rejected');
    expect(text).toContain('30:00');
    expect(text).toContain('The DJ role or Manage Server');
    expect(text).not.toContain('ditolak');
  });

  it('embed hasil pencarian memakai judul, deskripsi, dan footer bahasa Inggris', () => {
    const text = embedText(searchResultsEmbed({ query: 'daft punk', tracks: [track()] }, en));

    expect(text).toContain('Search results');
    expect(text).toContain('Results for `daft punk`');
    expect(text).toContain('Top 1 results');
    expect(text).toContain('15 minutes');
    expect(text).not.toContain('hasil pencarian');
  });
});

describe('renderer musik tanpa penerjemah', () => {
  it('nilai bawaannya persis sama seperti sebelum ada i18n', () => {
    const current = track();

    const idText = embedText(nowPlayingEmbed(current, snapshot(2, current)));
    expect(idText).toContain('Diminta oleh');
    expect(idText).toContain('Diputar sejak');
    expect(idText).toContain('2 lagu');
    expect(embedText(queueEmbed(snapshot(2)))).toContain('Berikutnya');
    expect(embedText(renderPlayOutcome({ kind: 'rejected', reason: 'too-long', count: 1 }))).toContain(
      '1 lagu ditolak',
    );
  });

  it('katalog bahasa Indonesia dan renderer bawaan menghasilkan teks yang sama', () => {
    const current = track();
    const data = snapshot(2, current);

    expect(embedText(nowPlayingEmbed(current, data, id))).toBe(embedText(nowPlayingEmbed(current, data)));
    expect(embedText(queueEmbed(snapshot(2), undefined, id))).toBe(embedText(queueEmbed(snapshot(2))));
  });
});

describe('label mode dan tombol', () => {
  it('loop dan filter punya label berbeda per bahasa', () => {
    expect(loopModeLabel('queue')).toBe('Ulangi antrean');
    expect(loopModeLabel('queue', en)).toBe('Repeat queue');
    expect(loopModeLabel('off', en)).toBe('Off');

    expect(filterModeLabel('off')).toBe('Normal (tanpa filter)');
    expect(filterModeLabel('off', en)).toBe('Normal (no filter)');
    expect(filterModeLabel('8d', en)).toBe('8D');
  });

  it('petunjuk pilihan juga diterjemahkan', () => {
    expect(loopModeHint(en)).toBe('`Off` / `Repeat track` / `Repeat queue`');
    expect(filterModeHint(en)).toBe(
      '`Normal (no filter)` / `Bassboost` / `Nightcore` / `Vaporwave` / `8D`',
    );
  });

  it('tombol navigasi memakai label bahasa server', () => {
    const page = buildQueuePage(snapshot(25).upcoming, 2);
    const json = JSON.stringify(queueNavRow(page, en)?.toJSON());

    expect(json).toContain('First');
    expect(json).toContain('Previous');
    expect(json).toContain('Last');
    expect(json).not.toContain('Awal');
  });
});

describe('pesan yang memuat durasi dan contoh format', () => {
  it('durasi ikut diterjemahkan tanpa disalin sebagai angka tetap ke katalog', () => {
    expect(trackLimitReason('too-long', {}, en)).toBe('over the 6:00:00 limit');
    expect(trackLimitReason('needs-control', { durationMs: 1 }, en)).toBe('longer than 30:00');
    expect(trackLimitReason('needs-control', {}, en)).toBe(
      'longer than 30:00 (or a live stream)',
    );

    expect(trackLimitRejectionMessage('too-long', 2, en)).toContain('2 tracks rejected');
    expect(trackLimitRejectionMessage('too-long', 2)).toContain('2 lagu ditolak');
  });

  it('contoh format posisi ikut diterjemahkan karena itu instruksi, bukan keterangan', () => {
    expect(seekErrorMessage('live', en)).toContain('live stream');
    expect(seekErrorMessage('invalid', en)).toContain('1m30s');
    expect(seekErrorMessage('invalid')).toContain('1m30s');
  });
});

/**
 * Penjaga: tidak boleh ada kalimat Bahasa Indonesia yang ditulis langsung di
 * berkas perintah musik.
 *
 * Yang diperiksa hanya badan perintah, bukan blok `data:` — nama dan deskripsi
 * perintah memang disengaja tidak diterjemahkan di kode, karena Discord
 * membacanya dari payload saat deploy dan sudah ditangani `commandTranslations`.
 *
 * Heuristiknya sengaja kasar: pola yang cukup untuk menangkap kalimat yang
 * tertinggal, tanpa perlu memeriksa kata, ID fitur, atau format internal.
 */
describe('penjaga: tidak ada teks Indonesia yang tertinggal di perintah musik', () => {
  it('setiap perintah musik mengambil teks dari katalog', async () => {
    const files = await listModuleFiles('src/commands/music');
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const body = commandBody(source);

      for (const literal of stringLiterals(body)) {
        if (looksIndonesian(literal)) offenders.push(`${file}: ${literal}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    // Kalau ini rapuh, penjaga di atas hanya rapi tapi tidak berguna: ia akan
    // lolos dalam keadaan kosong maupun dalam keadaan penuh teks.
    expect(looksIndonesian('Tidak ada lagu yang sedang diputar.')).toBe(true);
    expect(looksIndonesian('Antrean sudah penuh, tunggu sampai ada lagu yang selesai.')).toBe(true);
    expect(looksIndonesian('Permintaan itu tidak bisa diproses.')).toBe(true);

    expect(looksIndonesian('This request could not be processed.')).toBe(false);
    expect(looksIndonesian('Music commands only work inside a server.')).toBe(false);
    expect(looksIndonesian('unknown')).toBe(false);
    expect(looksDutchOrCode('https://example.com/1')).toBe(true);
    expect(looksDutchOrCode('music.play.started')).toBe(true);
    expect(looksDutchOrCode('Tidak ada apa pun di sini.')).toBe(false);

    // Nama hak akses mengandung spasi, jadi tidak tertangkap sebagai "kode" —
    // yang membuat penjaga lolos adalah panjangnya, bukan bentuknya.
    expect(looksDutchOrCode('Manage Server')).toBe(false);
    expect(looksIndonesian('Manage Server')).toBe(false);
    expect(looksIndonesian('Lavalink belum terhubung, jadi bot tidak bisa memutar lagu.')).toBe(
      true,
    );
  });
});

/**
 * Isi badan perintah, tanpa komentar.
 *
 * Dipotong setelah blok `data:` karena nama dan deskripsi perintah memang
 * tidak diterjemahkan di kode: Discord membacanya dari payload saat deploy,
 * dan itu sudah ditangani `commandTranslations`.
 *
 * Komentar ikut dibuang karena prosa di dalamnya sering mengutip pesan lama
 * untuk menjelaskan sebuah keputusan. Teks seperti itu tidak pernah
 * sampai ke pengguna, jadi ikut menghitungnya hanya menambah comoditas.
 */
function commandBody(source: string): string {
  const marker = source.indexOf("category: '");
  const body = marker === -1 ? source : source.slice(marker);

  return stripComments(body);
}

/** Buang komentar baris dan blok, sisakan string yang benar-benar dipakai. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** String literal satu maupun dua kutip, apa adanya isinya. */
function stringLiterals(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
    const value = match[1] ?? match[2];
    if (value) found.push(value);
  }

  return found;
}

/**
 * Kata penanda kalimat Bahasa Indonesia.
 *
 * Dipakai dengan spasi di depan supaya hanya cocok di batas kata: "dari"
 * ada di "dariSlack" dan "hurufnya", dan pola seperti itu akan membuat
 * penjaga menolak teks yang sebenarnya sudah benar.
 */
const STOPWORDS = [
  ' tidak',
  ' sudah',
  ' belum',
  ' lagi',
  ' dengan',
  ' untuk',
  ' harus',
  ' dari ',
  ' yang ',
  ' bisa',
  ' atau ',
];

/** URL dan kunci katalog bukan kalimat, meski isinya huruf. */
function looksDutchOrCode(literal: string): boolean {
  return /^https?:\/\//.test(literal) || /^[\w.:/<>-]+$/.test(literal);
}

/** Heuristik kasar "kayaknya kalimat Bahasa Indonesia". */
function looksIndonesian(literal: string): boolean {
  if (literal.length < 15) return false;
  if (looksDutchOrCode(literal)) return false;
  if (!literal.includes(' ')) return false;

  const lower = ` ${literal.toLowerCase()} `;
  const hits = STOPWORDS.filter((word) => lower.includes(word.toLowerCase())).length;

  // Dua kata penanda atau lebih: satu kata bisa muncul kebetulan di teks
  // Inggris, dua kata hampir tidak pernah.
  return hits >= 2;
}