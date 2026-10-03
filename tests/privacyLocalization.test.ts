import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { translator } from '../src/modules/i18n/index.js';
import {
  REASON_ANONYMIZED_MARKER,
  SUBJECT_ANONYMIZED_MARKER,
  buildInventory,
  dataDeleteConfirmEmbed,
  dataDeleteEmbed,
  dataDeleteLogEmbed,
  dataDeleteLogLine,
  emptyAnonymizeOutcome,
  inventoryRows,
  privacyEmbed,
} from '../src/modules/privacy/index.js';
import { MODERATION_RETENTION_YEARS } from '../src/modules/privacy/retention.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';

const id = translator('id');
const en = translator('en');

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const OTHER_USER_ID = '444444444444444444';

interface EmbedData {
  title?: string;
  description?: string;
  footer?: { text?: string };
  fields?: Array<{ name?: string; value?: string }>;
}

/** Seluruh teks embed apa adanya, supaya tidak ada bagian yang lolos dari cek. */
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

function inventory() {
  return buildInventory({
    guildId: GUILD_ID,
    userId: USER_ID,
    actionRows: [
      { type: 'warn', active: true, count: 3 },
      { type: 'note', active: true, count: 1 },
    ],
    activeWarnings: 3,
    tickets: 1,
    ticketTranscripts: 1,
    logEntries: 12,
    playlists: 2,
    customCommands: 1,
  });
}

const outcome = (overrides = {}) => ({
  ...emptyAnonymizeOutcome('anon:0123456789'),
  cases: 2,
  warnings: 1,
  tickets: 1,
  transcripts: 2,
  logEntries: 12,
  playlists: 2,
  customCommands: 1,
  ...overrides,
});

describe('privasi dalam bahasa Inggris', () => {
  it('embed /privacy memakai judul, field, dan footer bahasa server', () => {
    const text = embedText(privacyEmbed(inventory(), en));

    expect(text).toContain(`<@${USER_ID}>`);
    expect(text).toContain('Data Harmony stores about');
    expect(text).toContain('Moderation cases');
    expect(text).toContain('Warnings still in effect');
    expect(text).toContain('Your playlists');
    expect(text).toContain('Custom commands you created');
    expect(text).toContain('Retention');
    expect(text).toContain('Never stored');
    expect(text).toContain('Voice or video call contents');
    expect(text).toContain('/data-delete');

    expect(text).not.toContain('Kasus moderasi');
    expect(text).not.toContain('Masa simpan');
    expect(text).not.toContain('Tidak pernah disimpan');
  });

  it('masa simpan diterjemahkan tanpa menyalin angka hari ke katalog', () => {
    const fields = privacyEmbed(inventory(), en).toJSON().fields ?? [];
    const retention = fields.find((field) => field.name === 'Retention')?.value ?? '';

    // Angka hari tetap milik retention.ts, kalimatnya milik katalog.
    expect(retention).toContain('Moderation cases, internal notes, & warnings');
    expect(retention).toContain('since the action was recorded');
    expect(retention).toContain('since the ticket was closed');
    expect(retention).toContain('360 days');
    expect(retention).not.toContain('hari');
    expect(retention).not.toContain('sejak');
  });

  it('jumlah tiket dan transkripnya tetap dua angka terpisah', () => {
    const rows = inventoryRows(inventory(), en);
    const tickets = rows.find((row) => row.label === 'Tickets opened (+ transcripts kept)');

    expect(tickets?.value).toBe('1 (+1)');
  });

  it('konfirmasi /data-delete memakai judul, saran, dan footer bahasa server', () => {
    const text = embedText(dataDeleteConfirmEmbed(inventory(), en));

    expect(text).toContain('Delete the data stored about you?');
    expect(text).toContain('This **cannot be undone**');
    expect(text).toContain('confirm:true');
    expect(text).toContain('Normal retention');
    expect(text).not.toContain('Hapus data yang disimpan');
  });

  it('footer konfirmasi tidak pernah menulis "1 years"', () => {
    // MODERATION_RETENTION_YEARS = 1 saat ini, jadi katalog harus punya kunci
    // tunggal dan jamak; kalau hanya satu kunci, teksnya jadi "1 years".
    const text = embedText(dataDeleteConfirmEmbed(inventory(), en));

    expect(text).not.toContain('1 years');
    expect(MODERATION_RETENTION_YEARS).toBe(1);
    expect(text).toContain('1 year');
  });

  it('hasil /data-delete menyebut semua kelompok yang dilepas', () => {
    const text = embedText(dataDeleteEmbed(outcome(), en));

    expect(text).toContain('Data deletion request processed');
    expect(text).toContain('Your identity in 2 cases');
    expect(text).toContain('Contents of 2 ticket conversation transcripts');
    expect(text).toContain('12 log entries that mention you');
    expect(text).toContain('Ownership of 2 playlists released');
    expect(text).toContain('creator of 1 custom commands released');
    expect(text).toContain('Pseudonym: anon:0123456789');
    expect(text).not.toContain('entri log');
  });

  it('embed log membedakan permintaan mandiri dan atas nama orang lain', () => {
    const self = embedText(
      dataDeleteLogEmbed(
        { actorId: USER_ID, targetId: USER_ID, outcome: outcome() },
        en,
      ),
    );
    const other = embedText(
      dataDeleteLogEmbed(
        { actorId: OTHER_USER_ID, targetId: USER_ID, outcome: outcome() },
        en,
      ),
    );

    expect(self).toContain('Self-Serve Data Deletion Request');
    expect(other).toContain('on Behalf of Another User');
    expect(other).toContain('Requested by');
    expect(other).toContain('Playlists anonymized: `2`');
    expect(other).toContain('Custom commands anonymized: `1`');
    expect(other).not.toContain('Mandiri');
  });

  it('baris log penyebut user juga mengikuti bahasa server', () => {
    const line = dataDeleteLogLine(
      { actorId: OTHER_USER_ID, targetId: USER_ID, outcome: outcome() },
      en,
    );

    expect(line).toContain(`<@${OTHER_USER_ID}>`);
    expect(line).toContain('Data deletion request on behalf of another user');
    expect(line).toContain('2 transcripts');
    expect(line).not.toContain('atas nama user lain');
  });
});

describe('privasi tanpa penerjemah', () => {
  it('nilai bawaannya persis bahasa Indonesia seperti sebelum ada i18n', () => {
    const text = embedText(privacyEmbed(inventory()));

    expect(text).toContain('Data yang disimpan Harmony tentang');
    expect(text).toContain('Kasus moderasi');
    expect(text).toContain('Masa simpan');
    expect(text).toContain('Tidak pernah disimpan');
    expect(text).toContain('sejak tiket ditutup');
  });

  it('katalog Indonesia dan nilai bawaan menghasilkan teks yang sama', () => {
    expect(embedText(privacyEmbed(inventory()))).toBe(
      embedText(privacyEmbed(inventory(), id)),
    );
    expect(embedText(dataDeleteEmbed(outcome()))).toBe(
      embedText(dataDeleteEmbed(outcome(), id)),
    );
    expect(
      embedText(
        dataDeleteLogEmbed({ actorId: USER_ID, targetId: USER_ID, outcome: outcome() }),
      ),
    ).toBe(
      embedText(
        dataDeleteLogEmbed(
          { actorId: USER_ID, targetId: USER_ID, outcome: outcome() },
          id,
        ),
      ),
    );
  });
});

/**
 * Berkas modul privasi yang teks runtime-nya sudah ikut katalog.
 *
 * Diverifikasi oleh tes di bawah: begitu satu berkas kehilangan penjaga,
 * daftarnya harus ikut diperkecil, dan begitu satu berkas menambah kalimat
 * Indonesia baru, tesnya gagal.
 *
 * `service.ts` dan `index.ts` sengaja tidak masuk: keduanya tidak pernah
 * menulis kalimat ke user — hanya ke logger internal — jadi mengunci teks
 * logger ke katalog hanya menambah pekerjaan tanpa manfaat.
 */
const SUDAH_DITERJEMAHKAN = ['anonymize.ts', 'embeds.ts', 'inventory.ts', 'retention.ts'];

/**
 * Berkas yang memang masih boleh berisi kalimat Indonesia.
 *
 * `anonymize.ts` menyimpan dua penanda yang ditulis ke database dan dibaca
 * moderator lewat UI, jadi teksnya ikut terlihat user. Penandanya **tidak**
 * bisa diterjemahkan: begitu ditulis, baris lama tidak lagi punya versi lain
 * yang bisa dibaca. Allow-list-nya diambil dari konstanta aslinya supaya ikut
 * bergerak kalau penandanya diganti.
 */
const DILEHKAN: Record<string, string[]> = {
  'anonymize.ts': [REASON_ANONYMIZED_MARKER, SUBJECT_ANONYMIZED_MARKER],
};

/** Perintah inti yang memanggil embed privasi; judul/pesan error-nya wajib lewat `t`. */
const COMMAND_FILES = [
  'src/commands/core/privacy.ts',
  'src/commands/core/data-delete.ts',
];

describe('penjaga: tidak ada teks Indonesia yang tertinggal di modul privasi', () => {
  it('literal Bahasa Indonesia di berkas yang sudah diterjemahkan tidak ada', async () => {
    const offenders = await indonesianLiterals();

    expect(offenders).toEqual([]);
  });

  it('judul dan nama field embed selalu lewat penerjemah', async () => {
    const offenders: string[] = [];

    for (const file of await listModuleFiles('src/modules/privacy')) {
      const name = basename(file);
      if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      const patterns = [/setTitle\(\s*'([^']*)'/g, /(?:title|name):\s*'([^']*)'/g];
      for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) {
          offenders.push(name + ' -> ' + match[0]);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('pesan error di kedua perintah tidak pernah ditulis langsung', () => {
    // `errorEmbed` menerima kalimat jadi. Kalau ada literal Indonesia di
    // argumen pertamanya, member di server berbahasa Inggris akan membacanya
    // apa adanya — persis kelas bug yang modul ini disapu untuk menghilangkannya.
    const offenders: string[] = [];

    for (const file of COMMAND_FILES) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(/errorEmbed\(\s*'([^']*)'/g)) {
        offenders.push(basename(file) + ' -> ' + match[0]);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('daftar berkas yang sudah diterjemahkan sama persis dengan kenyataan', async () => {
    const files = (await listModuleFiles('src/modules/privacy'))
      .map((file) => basename(file))
      .filter((name) => name.endsWith('.ts'));

    const covered = files.filter((name) => SUDAH_DITERJEMAHKAN.includes(name));
    expect([...covered].sort()).toEqual([...SUDAH_DITERJEMAHKAN].sort());
  });

  it('allow-list penanda hanya berisi penanda yang benar-benar ada', async () => {
    const source = stripComments(readFileSync('src/modules/privacy/anonymize.ts', 'utf8'));

    for (const marker of DILEHKAN['anonymize.ts'] ?? []) {
      expect(source).toContain(marker);
    }
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    expect(looksIndonesian('Playlist milikmu dan perintah custom yang kamu buat')).toBe(true);
    expect(looksIndonesian('Tidak ada data yang tersimpan tentangmu di server ini.')).toBe(
      true,
    );

    expect(looksIndonesian('Your playlists')).toBe(false);
    expect(looksIndonesian('Voice or video call contents')).toBe(false);
    expect(looksIndonesian('privacy.row.playlists')).toBe(false);

    expect(looksCode('privacy.err.readFailed')).toBe(true);
    expect(looksCode('https://example.com/1')).toBe(true);
    expect(looksCode('Playlist milikmu dan perintah custom')).toBe(false);
  });
});

interface OffendingFile {
  file: string;
  literal: string;
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

async function indonesianLiterals(): Promise<OffendingFile[]> {
  const files = await listModuleFiles('src/modules/privacy');
  const offenders: OffendingFile[] = [];

  for (const file of files) {
    const name = basename(file);
    if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

    const allowList = DILEHKAN[name] ?? [];
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const literal of [...stringLiterals(source), ...templateFragments(source)]) {
      if (allowList.some((marker) => literal.includes(marker))) continue;
      if (looksIndonesian(literal)) offenders.push({ file, literal });
    }
  }

  return offenders;
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
 * Bagian statis dari template literal, dipecah per baris.
 *
 * Ekspresi `${…}` dibuang karena kalimat yang bocor ke template literal
 * biasanya pieces-nya yang salah, bukan keseluruhan template-nya.
 */
function templateFragments(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(/`([^`]*)`/g)) {
    const body = match[1];
    if (!body) continue;

    for (const fragment of body.replace(/\$\{[^}]*\}/g, '\n').split('\n')) {
      const trimmed = fragment.trim();
      if (trimmed) found.push(trimmed);
    }
  }

  return found;
}

/** Kunci katalog dan URL bukan kalimat, meski isinya huruf. */
function looksCode(literal: string): boolean {
  return /^https?:\/\//.test(literal) || /^[\w.:/<>-]+$/.test(literal);
}

/**
 * Kata penanda kalimat Bahasa Indonesia.
 *
 * Dipakai dengan spasi di depan supaya hanya cocok di batas kata, dan dengan
 * huruf kecil supaya cocok di tengah kalimat juga.
 */
const STOPWORDS = [
  ' tidak ',
  ' sudah ',
  ' belum ',
  ' dengan ',
  ' untuk ',
  ' harus ',
  ' dari ',
  ' yang ',
  ' bisa ',
  ' atau ',
  ' sebelum ',
  ' dan ',
  ' tanpa ',
  ' tentang ',
  ' member ',
  ' server ',
  ' di sini',
];

/** Heuristik kasar "kayaknya kalimat Bahasa Indonesia". */
function looksIndonesian(literal: string): boolean {
  if (literal.length < 15) return false;
  if (looksCode(literal)) return false;
  if (!literal.includes(' ')) return false;

  const lower = ` ${literal.toLowerCase()} `;
  const hits = STOPWORDS.filter((word) => lower.includes(word.toLowerCase())).length;

  // Dua kata penanda atau lebih: satu kata bisa muncul kebetulan di teks
  // Inggris, dua kata hampir tidak pernah.
  return hits >= 2;
}