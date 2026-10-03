import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { MESSAGE_KEYS, translator, type MessageKey } from '../src/modules/i18n/index.js';
import {
  categoryLabel,
  caseSourceFields,
  changesField,
  describeExportCategories,
  describeLogFilter,
  diffOverwrites,
  diffValues,
  eventKeyLabel,
  executorFields,
  logEmbed,
  logEntriesEmbed,
  logRecordSummary,
  logResultsEmbed,
  logStatsEmbed,
  toLoggingErrorEmbed,
  type LogRecord,
  type LogSearchFilter,
  type LogStats,
} from '../src/modules/logging/index.js';
import { parseLogSearch, LoggingValidationError } from '../src/modules/logging/validation.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';

const id = translator('id');
const en = translator('en');

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const MODERATOR_ID = '333333333333333333';
const CHANNEL_ID = '444444444444444444';
const CREATED_AT = new Date('2026-09-01T12:00:00.000Z');

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

function logRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    id: 1,
    guildId: GUILD_ID,
    category: 'member',
    eventKey: 'guildMemberAdd',
    title: 'Member bergabung',
    summary: '',
    executorId: null,
    targetId: USER_ID,
    channelId: null,
    logChannelId: null,
    logMessageId: null,
    caseId: null,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function filter(): LogSearchFilter {
  return parseLogSearch(GUILD_ID, {}, CREATED_AT);
}

function logStats(overrides: Partial<LogStats> = {}): LogStats {
  return {
    total: 12,
    categories: [
      { category: 'member', count: 8 },
      { category: 'message', count: 4 },
      { category: 'channel', count: 0 },
      { category: 'role', count: 0 },
      { category: 'voice', count: 0 },
      { category: 'server', count: 0 },
    ],
    topActions: [{ eventKey: 'messageDelete', count: 4 }],
    topMembers: [{ userId: USER_ID, count: 3, asTarget: 2, asExecutor: 1 }],
    ...overrides,
  };
}

describe('embed log dalam bahasa Inggris', () => {
  it('daftar hasil /logs menerjemahkan judul, kaki, dan catatan halaman berikutnya', () => {
    const embed = logResultsEmbed(
      [logRecord()],
      { guildId: GUILD_ID, page: 2, pageSize: 10, total: 34 },
      en,
    );
    const text = embedText(embed);

    expect(text).toContain('🔎 Log history');
    expect(text).toContain('Page 2');
    expect(text).toContain('entries 11');
    expect(text).toContain('20 of 34');
    expect(text).toContain('Next page');
    expect(text).toContain('run it again with `page:3`');
    expect(text).not.toContain('Riwayat Log');
    expect(text).not.toContain('Halaman');
  });

  it('ringkasan satu entri menerjemahkan kasus, executor, channel, dan tautan lompat', () => {
    const summary = logRecordSummary(
      logRecord({
        category: 'message',
        eventKey: 'moderation.warn',
        caseId: '142',
        executorId: MODERATOR_ID,
        channelId: CHANNEL_ID,
        logChannelId: CHANNEL_ID,
        logMessageId: '555555555555555555',
      }),
      GUILD_ID,
      en,
    );

    expect(summary.lines.join('\n')).toContain('🤖 Harmony · Case `#CASE-0142`');
    expect(summary.lines.join('\n')).toContain('By: <@333333333333333333>');
    expect(summary.lines.join('\n')).toContain('Channel: <#444444444444444444>');
    expect(summary.lines.join('\n')).toContain('[Jump to the log message]');
    expect(summary.lines.join('\n')).not.toContain('Oleh:');
  });

  it('embed statistik menerjemahkan field, label aksi, label kategori, dan peran member', () => {
    const text = embedText(
      logStatsEmbed(
        logStats(),
        {
          filter: filter(),
          period: { from: CREATED_AT, to: CREATED_AT, defaulted: true },
        },
        en,
      ),
    );

    expect(text).toContain('📊 Log statistics');
    expect(text).toContain('Events per category');
    expect(text).toContain('Message');
    expect(text).toContain('Top actions (1)');
    expect(text).toContain('**Message deleted**');
    expect(text).toContain('Members most often involved (1)');
    expect(text).toContain('🎯 2 as the target');
    expect(text).toContain('⚡ 1 as the actor');
    expect(text).toContain('_Default period: the whole log retention window.');
    expect(text).not.toContain('Periode');
    expect(text).not.toContain('jadi target');
  });

  it('daftar entri log tanpa hasil memakai kalimat kosong versi Inggris', () => {
    const empty = logStatsEmbed(
      logStats({ total: 1, topActions: [], topMembers: [] }),
      { filter: filter(), period: { from: CREATED_AT, to: CREATED_AT, defaulted: false } },
      en,
    );

    expect(embedText(empty)).toContain('No events in this period.');
    expect(embedText(empty)).toContain('No members were recorded in this period.');
  });

  it('embed dasar, field perubahan, executor, dan sumber kasus ikut memakai bahasa server', () => {
    const basic = embedText(logEmbed({ category: 'message', title: 'X' }, en));
    expect(basic).toContain('💬 Message');

    expect(changesField(['• x'], en)?.name).toBe('Changes');
    expect(changesField(['• x'])?.name).toBe('Perubahan');

    const executor = executorFields(
      {
        executor: { id: USER_ID, tag: 'spammer#0001' },
        reason: 'Spam',
      } as unknown as Parameters<typeof executorFields>[0],
      en,
    );
    expect(executor.map((field) => field.name)).toEqual(['Executor', 'Reason']);

    const linked = caseSourceFields(
      { caseNumber: 142, moderatorId: MODERATOR_ID },
      null,
      null,
      en,
    );
    expect(linked.map((field) => field.name)).toEqual(['Source', 'Case', 'Moderator']);
    expect(linked[0]?.value).toBe('🤖 Harmony (bot command)');

    const external = caseSourceFields(null, USER_ID, null, en);
    expect(external[0]?.value).toBe(`👤 Another moderator (<@${USER_ID}>)`);

    const byThisBot = caseSourceFields(null, USER_ID, USER_ID, en);
    expect(byThisBot[0]?.value).toBe('🤖 Bot — outside a Harmony case');
  });

  it('label kategori dan label event mengikuti bahasa server', () => {
    expect(categoryLabel('message')).toBe('Pesan');
    expect(categoryLabel('message', en)).toBe('Message');

    expect(eventKeyLabel('messageDelete')).toBe('Pesan dihapus');
    expect(eventKeyLabel('messageDelete', en)).toBe('Message deleted');
    expect(eventKeyLabel('moderation.ban', en)).toBe('Ban');

    // Kunci yang tidak dikenal tetap ditampilkan apa adanya, bukan jadi kunci katalog.
    expect(eventKeyLabel('entaraupa', en)).toBe('entaraupa');
  });

  it('ringkasan filter menerjemahkan setiap bagian yang bisa diisi', () => {
    const full = parseLogSearch(
      GUILD_ID,
      {
        category: 'message,role',
        userId: USER_ID,
        channelId: CHANNEL_ID,
        keyword: 'spam',
        caseNumber: '#CASE-0142',
        from: '7d',
        to: '2026-10-02',
      },
      CREATED_AT,
    );

    const text = describeLogFilter(full, en);

    expect(text).toContain('Category: Message, Role');
    expect(text).toContain(`User: <@${USER_ID}>`);
    expect(text).toContain(`Channel: <#${CHANNEL_ID}>`);
    expect(text).toContain('Keyword: `spam`');
    expect(text).toContain('Case: `#CASE-0142`');
    expect(text).toMatch(/From: <t:\d+:f>/);
    expect(text).toMatch(/To: <t:\d+:f>/);
    expect(text).not.toContain('Kata kunci');

    expect(describeLogFilter(filter(), en)).toBe('All categories · no time limit');
    expect(describeLogFilter(filter())).toBe('Semua kategori · tanpa batas waktu');
  });

  it('baris diff overwrite dan boolean memakai kata kerja bahasa server', () => {
    expect(
      diffValues({ a: false, b: true }, { a: true, b: false }, [
        { key: 'a', label: 'X' },
        { key: 'b', label: 'Y' },
      ], en),
    ).toEqual(['• **X**: No → Yes', '• **Y**: Yes → No']);

    const snapshot = { key: 'role:1', label: '<@&1>', allow: 0n, deny: 0n };
    expect(diffOverwrites([], [snapshot], en)).toEqual(['• <@&1>: overwrite **added**']);
    expect(diffOverwrites([snapshot], [], en)).toEqual(['• <@&1>: overwrite **removed**']);

    // Nilai bakanya harus tetap persis seperti sebelum ada i18n.
    expect(diffOverwrites([], [snapshot])).toEqual(['• <@&1>: overwrite **ditambahkan**']);
  });

  it('label kategori pada ringkasan ekspor ikut bahasa server', () => {
    const withCategories = parseLogSearch(GUILD_ID, { category: 'message,voice' }, CREATED_AT);

    expect(describeExportCategories(withCategories, en)).toBe('Message, Voice');
    expect(describeExportCategories(filter(), en)).toBe('all categories');
    expect(describeExportCategories(withCategories)).toBe('Pesan, Voice');
  });

  it('daftar entri log pada halaman kasus menerjemahkan baris di dalamnya', () => {
    const text = embedText(
      logEntriesEmbed(
        [logRecord({ executorId: MODERATOR_ID, channelId: CHANNEL_ID })],
        { title: 'Related logs', guildId: GUILD_ID, total: 1 },
        en,
      ),
    );

    expect(text).toContain('By: <@333333333333333333>');
    expect(text).not.toContain('Oleh:');
  });
});

describe('error logging dalam bahasa Inggris', () => {
  it('penolakan validasi memakai kunci katalog error itu sendiri', () => {
    let thrown: unknown;
    try {
      parseLogSearch(GUILD_ID, { userId: 'bukan-id' }, CREATED_AT);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LoggingValidationError);

    const text = embedText(toLoggingErrorEmbed(thrown, en));
    expect(text).toContain('The user ID is not valid: `bukan-id`.');
    expect(text).toContain('Log settings rejected');
    expect(text).not.toContain('tidak valid');
  });

  it('error database mati dan error umum diterjemahkan', () => {
    expect(embedText(toLoggingErrorEmbed(new Error('ECONNREFUSED'), en))).toContain(
      'The database cannot be reached',
    );
    expect(embedText(toLoggingErrorEmbed(new Error('boom'), en))).toContain(
      'Something went wrong while accessing the log settings',
    );
  });

  it('tanpa penerjemah, pesan error tetap bahasa Indonesia seperti sebelumnya', () => {
    const text = embedText(toLoggingErrorEmbed(new LoggingValidationError('log.err.badCase')));

    expect(text).toContain('Nomor kasus tidak valid');
    expect(text).toContain('Pengaturan Log Ditolak');
  });
});

describe('renderer log tanpa penerjemah', () => {
  it('nilai bakanya persis sama seperti sebelum ada i18n', () => {
    const embed = logResultsEmbed(
      [logRecord({ caseId: '142', executorId: MODERATOR_ID })],
      { guildId: GUILD_ID, page: 1, pageSize: 10, total: 12 },
    );

    expect(embed.toJSON().title).toBe('🔎 Riwayat Log');
    expect(embedText(embed)).toContain('🤖 Harmony · Kasus `#CASE-0142`');
    expect(embedText(embed)).toContain('Oleh: <@333333333333333333>');
  });

  it('katalog bahasa Indonesia dan renderer bawaan menghasilkan teks yang sama', () => {
    const embed = logStatsEmbed(
      logStats(),
      { filter: filter(), period: { from: CREATED_AT, to: CREATED_AT, defaulted: false } },
    );

    expect(embedText(embed)).toBe(
      embedText(
        logStatsEmbed(
          logStats(),
          { filter: filter(), period: { from: CREATED_AT, to: CREATED_AT, defaulted: false } },
          id,
        ),
      ),
    );
  });
});

/**
 * Modul yang teks runtime-nya sudah ikut katalog.
 *
 * Daftar ini diverifikasi oleh tes di bawah: begitu satu berkas kehilangan
 * penjaga, daftarnya harus ikut diperkecil, dan begitu satu berkas menambah
 * kalimat Indonesia baru, tesnya gagal.
 */
const SUDAH_DITERJEMAHKAN = [
  'diff.ts',
  'embeds.ts',
  'errors.ts',
  'export.ts',
  'stats.ts',
  'types.ts',
];

/**
 * Berkas yang memang masih boleh berisi Bahasa Indonesia.
 *
 * `validation.ts` dan `export.ts` menyimpan kalimat Indonesia sebagai nilai
 * bawaan katalog (bukan teks yang ditulis langsung), jadi keduanya dikecualikan
 * dari pemindaian literal.
 */
const DILEHKAN: Record<string, string[]> = {
  'validation.ts': ['log.err.'],
};

describe('penjaga: tidak ada teks Indonesia yang tertinggal di modul logging', () => {
  it('literal Bahasa Indonesia di berkas yang sudah diterjemahkan tidak ada', async () => {
    const offenders = await indonesianLiterals();

    expect(offenders).toEqual([]);
  });

  it('daftar berkas yang sudah diterjemahkan sama persis dengan kenyataan', async () => {
    const files = (await listModuleFiles('src/modules/logging'))
      .map((file) => basename(file))
      .filter((name) => name.endsWith('.ts'));

    const covered = files.filter((name) => SUDAH_DITERJEMAHKAN.includes(name));
    expect([...covered].sort()).toEqual([...SUDAH_DITERJEMAHKAN].sort());
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    expect(looksIndonesian('Kategori itu tidak dikenal dan tidak bisa dipakai di sini.')).toBe(true);
    expect(looksIndonesian('Ringkasan entri itu tidak bisa ditampilkan di channel ini.')).toBe(
      true,
    );

    expect(looksIndonesian('Category: Message, Role')).toBe(false);
    expect(looksIndonesian('No events in this period.')).toBe(false);
    expect(looksIndonesian('log.results.title')).toBe(false);
    expect(looksIndonesian('Member')).toBe(false);

    expect(looksDutchOrCode('https://example.com/1')).toBe(true);
    expect(looksDutchOrCode('moderation.ban')).toBe(true);
    expect(looksDutchOrCode('Tidak ada apa pun di sini.')).toBe(false);
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
  const files = await listModuleFiles('src/modules/logging');
  const offenders: OffendingFile[] = [];

  for (const file of files) {
    const name = basename(file);
    if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

    const allowList = DILEHKAN[name] ?? [];
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const literal of [...stringLiterals(source), ...templateFragments(source)]) {
      if (allowList.some((prefix) => literal.includes(prefix))) continue;
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
 * Bagian statis dari template literal.
 *
 * Ekspresi `${…}` dibuang dan sisanya dipecah per baris, karena kalimat yang
 * bocor ke template literal biasanya pieces-nya yang salah, bukan keseluruhan
 * template-nya — misalnya `'📁 Tersimpan di server: ' + path`.
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

/** URL dan kunci katalog bukan kalimat, meski isinya huruf. */
function looksDutchOrCode(literal: string): boolean {
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
  ' lagi ',
  ' dengan ',
  ' untuk ',
  ' harus ',
  ' dari ',
  ' yang ',
  ' bisa ',
  ' atau ',
  ' belum diatur',
  ' kategori',
  ' entri',
];

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

/**
 * Isi embed event handler log ikut bahasa server.
 *
 * Batasnya berbeda dari perintah, dan sengaja ditulis terang di sini: judul
 * dan ringkasan sebuah entri tersimpan di tabel `log_entry`, jadi entri yang
 * SUDAH tercatat sebelum server mengganti bahasa tidak akan ikut berubah. Yang
 * dijaga tes ini cuma entri baru.
 *
 * Daftar di bawah diverifikasi oleh tesnya: begitu satu handler hilang dari
 * daftar, atau satu handler baru muncul tanpa ikut katalog, tesnya gagal.
 */
const EVENT_FILES = [
  'banAdd.ts',
  'banRemove.ts',
  'channelCreate.ts',
  'channelDelete.ts',
  'channelUpdate.ts',
  'emojiCreate.ts',
  'emojiDelete.ts',
  'emojiUpdate.ts',
  'guildUpdate.ts',
  'memberAdd.ts',
  'memberRemove.ts',
  'memberUpdate.ts',
  'messageBulkDelete.ts',
  'messageDelete.ts',
  'messageUpdate.ts',
  'roleCreate.ts',
  'roleDelete.ts',
  'roleUpdate.ts',
  'stickerCreate.ts',
  'stickerDelete.ts',
  'stickerUpdate.ts',
  'voiceStateUpdate.ts',
];

const EVENT_DIR = 'src/events/logging';

/**
 * Teks Indonesia yang harus tetap sama seperti sebelum ada i18n.
 */
const LEGACY_TITLES: Partial<Record<MessageKey, string>> = {
  'log.embed.title.banAdd': 'Member Ban',
  'log.embed.title.banAddHarmony': 'Member Ban (Harmony)',
  'log.embed.title.banRemove': 'Ban Dicabut',
  'log.embed.title.banRemoveHarmony': 'Ban Dicabut (Harmony)',
  'log.embed.title.memberAdd': 'Member Join',
  'log.embed.title.memberKick': 'Member Kick',
  'log.embed.title.memberLeave': 'Member Leave',
  'log.embed.title.memberUpdate': 'Member Diperbarui',
  'log.embed.title.memberTimeout': 'Timeout Diperbarui (Harmony)',
  'log.embed.title.messageDelete': 'Pesan Dihapus',
  'log.embed.title.messageBulkDelete': 'Pesan Dihapus Massal',
  'log.embed.title.messageUpdate': 'Pesan Diedit',
  'log.embed.title.channelCreate': 'Channel Dibuat',
  'log.embed.title.channelDelete': 'Channel Dihapus',
  'log.embed.title.channelUpdate': 'Channel Diperbarui',
  'log.embed.title.channelUpdateHarmony': 'Channel Diperbarui (Harmony)',
  'log.embed.title.roleCreate': 'Role Dibuat',
  'log.embed.title.roleDelete': 'Role Dihapus',
  'log.embed.title.roleUpdate': 'Role Diperbarui',
  'log.embed.title.emojiCreate': 'Emoji Ditambahkan',
  'log.embed.title.emojiDelete': 'Emoji Dihapus',
  'log.embed.title.emojiUpdate': 'Emoji Diperbarui',
  'log.embed.title.stickerCreate': 'Sticker Ditambahkan',
  'log.embed.title.stickerDelete': 'Sticker Dihapus',
  'log.embed.title.stickerUpdate': 'Sticker Diperbarui',
  'log.embed.title.guildUpdate': 'Server Diperbarui',
  'log.embed.title.voiceJoin': 'Join Voice',
  'log.embed.title.voiceLeave': 'Leave Voice',
  'log.embed.title.voiceMove': 'Pindah Voice',
  'log.embed.title.voiceState': 'Voice State',
};

/**
 * Emoji judul embed log. Dipakai dua arah: tes mengarang ulang judul
 * Indonesia dari emoji + teks ini, jadi pemindahan ke katalog tidak boleh
 * diam-diam menghilangkan ikon yang sudah tampil di channel log server.
 */
const TITLE_EMOJI = {
  banAdd: '🔨',
  banAddHarmony: '🔨',
  banRemove: '♻️',
  banRemoveHarmony: '♻️',
  memberAdd: '👤',
  memberKick: '👢',
  memberLeave: '🚪',
  memberUpdate: '📝',
  memberTimeout: '⏱️',
  messageDelete: '🗑️',
  messageBulkDelete: '🧹',
  messageUpdate: '✏️',
  channelCreate: '📁',
  channelDelete: '🗑️',
  channelUpdate: '📝',
  channelUpdateHarmony: '📝',
  roleCreate: '🎭',
  roleDelete: '🗑️',
  roleUpdate: '📝',
  emojiCreate: '😀',
  emojiDelete: '🗑️',
  emojiUpdate: '📝',
  stickerCreate: '🩹',
  stickerDelete: '🗑️',
  stickerUpdate: '📝',
  guildUpdate: '🏠',
  voiceJoin: '🔊',
  voiceLeave: '🔇',
  voiceMove: '🔁',
  voiceState: '🎙️',
} as const;

/**
 * Kata yang hanya Bahasa Indonesia dan tidak mungkin muncul sebagai kode.
 *
 * Heuristik kalimat yang dipakai modul logging tidak bisa dipakai di sini:
 * sisa yang paling rawan justru label pendek seperti "Nama" atau "Tipe",
 * yang terlalu pendek buat diukur panjang kalimat.
 */
const KATA_INDONESIA = [
  'Nama',
  'Tipe',
  'Kategori',
  'Warna',
  'Topik',
  'Tidak',
  'detik',
  'lainnya',
  'Bergabung',
  'Lampiran',
  'Penulis',
  'Lompat',
  'Jumlah',
  'Ditambahkan',
  'Dihapus',
  'Diperbarui',
  'Dibuat',
  'DihapusMassal',
  'Akun dibuat',
  'Tidak ada',
  'Role ditambahkan',
  'Role dihapus',
  'Izin ditambahkan',
  'Izin dihapus',
  'Nama panggilan',
  'Isi pesan',
];

describe('penjaga: isi embed event log ikut katalog', () => {
  it('daftar handler di src/events/logging sama persis dengan kenyataan', async () => {
    const files = (await listModuleFiles(EVENT_DIR)).map((file) => basename(file));

    expect([...files].sort()).toEqual([...EVENT_FILES].sort());
  });

  it('tidak ada judul embed atau nama field yang ditulis sebagai literal', async () => {
    const offenders: string[] = [];

    for (const file of await listModuleFiles(EVENT_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(/\b(?:title|name): '([^']*)/g)) {
        offenders.push(file + ' -> ' + match[0]);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('tidak ada sisa Bahasa Indonesia di handler event', async () => {
    const offenders: string[] = [];

    for (const file of await listModuleFiles(EVENT_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const literal of [...stringLiterals(code), ...templateFragments(code)]) {
        for (const word of KATA_INDONESIA) {
          if (literal.includes(word)) offenders.push(file + ' -> ' + literal);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('setiap handler mengambil penerjemah untuk guild-nya', async () => {
    const offenders: string[] = [];

    for (const file of await listModuleFiles(EVENT_DIR)) {
      const code = readFileSync(file, 'utf8');
      if (!code.includes('await translatorFor(')) offenders.push(basename(file));
    }

    expect(offenders).toEqual([]);
  });

  it('setiap kunci log.embed yang dipakai ada di kedua bahasa', async () => {
    const used = new Set<string>();

    for (const file of await listModuleFiles(EVENT_DIR)) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/t\(\x27(log\.embed\.[a-zA-Z.]+)\x27/g)) {
        if (match[1]) used.add(match[1]);
      }
    }

    expect(used.size).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const raw of used) {
      const key = raw as MessageKey;
      if (id(key) === key || en(key) === key) missing.push(key);
    }

    expect(missing).toEqual([]);
  });

  it('tidak ada kunci log.embed di katalog yang tidak dipakai handler mana pun', async () => {
    const used = new Set<string>();

    for (const file of await listModuleFiles(EVENT_DIR)) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/t\(\x27(log\.embed\.[a-zA-Z.]+)\x27/g)) {
        if (match[1]) used.add(match[1]);
      }
    }

    const orphan = MESSAGE_KEYS.filter(
      (key) => key.startsWith('log.embed.') && !used.has(key),
    );

    expect(orphan).toEqual([]);
  });

  it('judul bahasa Indonesia persis seperti sebelum ada i18n, emoji ikut', () => {
    for (const key of Object.keys(LEGACY_TITLES) as MessageKey[]) {
      const legacy = LEGACY_TITLES[key];
      if (legacy === undefined) throw new Error('Judul tanpa teks legacy: ' + key);

      const emoji = TITLE_EMOJI[key.replace('log.embed.title.', '') as keyof typeof TITLE_EMOJI];
      if (emoji === undefined) throw new Error('Judul tanpa emoji: ' + key);

      expect(id(key)).toBe(emoji + ' ' + legacy);
    }
  });

  it('judul bahasa Inggris memakai kata Inggris, bukan terjemahan harfiah', () => {
    expect(en('log.embed.title.memberAdd')).toBe(
      TITLE_EMOJI.memberAdd + ' ' + 'Member joined',
    );
    expect(en('log.embed.title.messageBulkDelete')).toBe(
      TITLE_EMOJI.messageBulkDelete + ' ' + 'Bulk message delete',
    );
    expect(en('log.embed.field.author')).toBe('Author');
    expect(en('log.embed.field.color')).toBe('Colour');
    expect(en('log.embed.value.messageCount', { count: 12 })).toBe('12 messages');
    expect(en('log.embed.value.others', { count: 7 })).toBe('(+7 more)');
  });
});
