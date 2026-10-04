import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { logEntriesEmbed } from '../src/modules/logging/index.js';
import {
  caseSummaryEmbed,
  moderationDmEmbed,
  moderationLogEmbed,
  moderationResultEmbed,
  notesEmbed,
  purgeLogEmbed,
  toModerationErrorEmbed,
  warningRevokedDmEmbed,
  warningRevokedLogEmbed,
  warningsEmbed,
} from '../src/modules/moderation/index.js';
import {
  checkModerationHierarchy,
  hierarchyMessage,
  type HierarchyCheck,
} from '../src/modules/moderation/hierarchy.js';
import { actionLabel, compareActions } from '../src/modules/moderation/types.js';
import type { ModerationCase, WarningRecord } from '../src/modules/moderation/types.js';
import { translator } from '../src/modules/i18n/index.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';

const id = translator('id');
const en = translator('en');

const GUILD_ID = '123456789012345678';
const TARGET_ID = '222222222222222222';
const MODERATOR_ID = '333333333333333333';
const CREATED_AT = new Date('2026-09-01T12:00:00.000Z');

function moderationCase(overrides: Partial<ModerationCase> = {}): ModerationCase {
  return {
    id: 1,
    caseNumber: 142,
    guildId: GUILD_ID,
    type: 'ban',
    targetId: TARGET_ID,
    moderatorId: MODERATOR_ID,
    reason: 'Spam',
    createdAt: CREATED_AT,
    expiresAt: null,
    active: true,
    dmStatus: 'sent',
    ...overrides,
  };
}

function warning(overrides: Partial<WarningRecord> = {}): WarningRecord {
  return {
    id: 1,
    caseId: 1,
    caseNumber: 7,
    guildId: GUILD_ID,
    userId: TARGET_ID,
    moderatorId: MODERATOR_ID,
    reason: 'Spam',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

/** Bentuk subset `EmbedBuilder.toJSON()` yang dipakai di sini. */
interface EmbedData {
  title?: string;
  description?: string;
  footer?: { text?: string };
  fields?: Array<{ name?: string; value?: string }>;
}

/**
 * Seluruh teks embed apa adanya, supaya tidak ada bagian yang lolos dari cek.
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
  'Alasan',
  'Selesai',
  'Belum',
  'Tidak',
  'Catatan',
  'tidak ada',
  'peringatan',
  'kasus',
  'sebuah',
];

describe('embed moderasi dalam bahasa Inggris', () => {
  it('embed log kasus memakai nama field, label aksi, dan footer bahasa Inggris', () => {
    const text = embedText(
      moderationLogEmbed(
        {
          action: 'ban',
          caseNumber: 142,
          targetId: TARGET_ID,
          moderatorId: MODERATOR_ID,
          reason: 'Spam',
          createdAt: CREATED_AT,
          dmSent: true,
        },
        en,
      ),
    );

    expect(text).toContain('🔨 Ban');
    expect(text).toContain('Case');
    expect(text).toContain('Target');
    expect(text).toContain('Moderator');
    expect(text).toContain('Reason');
    expect(text).toContain('DM to the target was delivered');

    for (const marker of INDONESIAN_MARKERS) {
      expect(text).not.toContain(marker);
    }
  });

  it('DM ke target ikut diterjemahkan, termasuk catatan untuk menghubungi moderator', () => {
    const text = embedText(
      moderationDmEmbed(
        {
          action: 'ban',
          caseNumber: 142,
          guildName: 'Harmony Test',
          reason: 'Spam',
          expiresAt: null,
        },
        en,
      ),
    );

    expect(text).toContain('You were banned from Harmony Test');
    expect(text).toContain('If you think this is a mistake, contact a server moderator.');
    expect(text).toContain('Reason');
    expect(text).not.toContain('di-ban dari');
  });

  it('balasan aksi memakai sufiks "Berhasil" versi Inggris', () => {
    const text = embedText(
      moderationResultEmbed(
        {
          action: 'timeout',
          caseNumber: 143,
          targetId: TARGET_ID,
          reason: 'Spam',
          expiresAt: CREATED_AT,
          extraLines: ['Timed out for **10m00s**.'],
        },
        en,
      ),
    );

    expect(text).toContain('⏳ Timeout Done');
    expect(text).toContain('Timed out for **10m00s**.');
    expect(text).toContain('Reason');
    expect(text).not.toContain('Berhasil');
  });

  it('alasan kosong pada embed log memakai bentuk miring yang diterjemahkan', () => {
    const text = embedText(
      moderationLogEmbed(
        {
          action: 'warn',
          caseNumber: 144,
          targetId: TARGET_ID,
          moderatorId: MODERATOR_ID,
          reason: null,
          createdAt: CREATED_AT,
        },
        en,
      ),
    );

    expect(text).toContain('*not specified*');
    expect(text).not.toContain('*tidak disebutkan*');
  });

  it('pencabutan peringatan diterjemahkan di DM maupun di log', () => {
    const dm = embedText(
      warningRevokedDmEmbed({ caseNumber: 7, guildName: 'Harmony Test', moderatorId: MODERATOR_ID }, en),
    );
    const log = embedText(
      warningRevokedLogEmbed({ caseNumber: 7, targetId: TARGET_ID, moderatorId: MODERATOR_ID }, en),
    );

    expect(dm).toContain('Warning revoked in Harmony Test');
    expect(dm).toContain('revoked by');
    expect(log).toContain('♻️ Warning revoked — #CASE-0007');
    expect(log).not.toContain('Peringatan Dicabut');
  });

  it('daftar peringatan dan catatan internal diterjemahkan, termasuk keadaan kosong', () => {
    const warnings = embedText(
      warningsEmbed({ id: TARGET_ID, tag: 'spammer' }, [warning()], 3, en),
    );

    expect(warnings).toContain('⚠️ Warnings — spammer');
    expect(warnings).toContain('3 warnings recorded in total');
    expect(warningsEmbed({ id: TARGET_ID, tag: 'spammer' }, [], 0, en).data.description).toBe(
      'No warnings recorded for this user.',
    );

    const notes = embedText(notesEmbed({ id: TARGET_ID, tag: 'spammer' }, [moderationCase({ type: 'note' })], en));

    expect(notes).toContain('📝 Internal notes — spammer');
    expect(notes).toContain('1 most recent notes shown');
    expect(notesEmbed({ id: TARGET_ID, tag: 'spammer' }, [], en).data.description).toBe(
      'No notes for this user yet.',
    );
  });

  it('log purge memakai judul, field, dan catatan filter bahasa Inggris', () => {
    const text = embedText(
      purgeLogEmbed(
        {
          moderatorId: MODERATOR_ID,
          channelId: '444444444444444444',
          deleted: 12,
          filters: ['Author: <@222222222222222222>', 'Contains: `spam`'],
        },
        en,
      ),
    );

    expect(text).toContain('🧹 Purge messages');
    expect(text).toContain('12 messages');
    expect(text).toContain('Amount');
    expect(text).toContain('Channel');
    expect(text).toContain('Contains:');
    expect(text).not.toContain('Mengandung');
  });

  it('halaman kasus menerjemahkan status, keadaan sekarang, dan notifikasi DM', () => {
    const record = moderationCase({ type: 'timeout', dmStatus: 'failed', reason: 'Spam' });
    const text = embedText(
      caseSummaryEmbed(
        record,
        { currentState: { banned: null, timeoutUntil: new Date(Date.now() + 600_000) } },
        en,
      ),
    );

    expect(text).toContain('Status');
    expect(text).toContain('Current state');
    expect(text).toContain('Notification');
    expect(text).toContain('Still timed out until');
    expect(text).toContain('Notification DM was **not delivered**');
    expect(text).not.toContain('Kondisi sekarang');
  });

  it('daftar entri log kosong diterjemahkan', () => {
    const text = embedText(
      logEntriesEmbed([], { title: 'Related logs', guildId: GUILD_ID, total: 0 }, en),
    );

    expect(text).toContain('No log entries were recorded.');
    expect(text).not.toContain('Tidak ada entri log');
  });
});

describe('kalimat penolakan dan error dalam bahasa Inggris', () => {
  /** Pintasan: pastikan hasil cek hierarki ditolak, lalu persempit tipenya. */
  function rejected(check: HierarchyCheck): Extract<HierarchyCheck, { ok: false }> {
    expect(check.ok).toBe(false);
    if (check.ok) throw new Error('hierarki seharusnya ditolak');

    return check;
  }

  it('semua aturan hierarki punya kalimat Inggris yang berbeda dari Indonesia', () => {
    const base = {
      actorId: '111111111111111111',
      targetId: TARGET_ID,
      botId: '333333333333333333',
      guildOwnerId: '444444444444444444',
      actorHighestRolePosition: 10,
      botHighestRolePosition: 8,
      targetHighestRolePosition: 5,
    };

    const self = rejected(checkModerationHierarchy({ ...base, targetId: base.actorId }));
    const botSelf = rejected(checkModerationHierarchy({ ...base, targetId: base.botId }));
    const owner = rejected(checkModerationHierarchy({ ...base, targetId: base.guildOwnerId }));
    const botLow = rejected(checkModerationHierarchy({ ...base, botHighestRolePosition: 5 }));
    const actorLow = rejected(checkModerationHierarchy({ ...base, actorHighestRolePosition: 5 }));

    for (const check of [self, botSelf, owner, botLow, actorLow]) {
      expect(hierarchyMessage(check, en)).not.toBe(hierarchyMessage(check, id));
      expect(hierarchyMessage(check, en).length).toBeGreaterThan(0);
    }

    expect(hierarchyMessage(actorLow, en)).toContain('Ask a more senior moderator');
    expect(hierarchyMessage(self, en)).toContain('cannot moderate yourself');
    expect(hierarchyMessage(botSelf, en)).toContain('I cannot moderate myself');
    expect(hierarchyMessage(owner, en)).toContain('server owner cannot be moderated');
    expect(hierarchyMessage(botLow, en)).toContain('higher than or equal to mine');
  });

  it('error database mati ditulis dalam bahasa server', () => {
    const text = embedText(toModerationErrorEmbed(new Error('ECONNREFUSED'), en));

    expect(text).toContain('Database is offline');
    expect(text).toContain('The database cannot be reached');
    expect(text).not.toContain('Database Offline');
  });

  it('error lain memakai kalimat umum, bukan pesan mentah dari server', () => {
    const text = embedText(toModerationErrorEmbed(new Error('boom'), en));

    expect(text).toContain('Something went wrong');
    expect(text).not.toContain('boom');
  });
});

describe('renderer moderasi tanpa penerjemah', () => {
  it('nilai bakanya persis sama seperti sebelum ada i18n', () => {
    const input = {
      action: 'ban' as const,
      caseNumber: 142,
      targetId: TARGET_ID,
      moderatorId: MODERATOR_ID,
      reason: null,
      createdAt: CREATED_AT,
      dmSent: false,
    };

    const text = embedText(moderationLogEmbed(input));

    expect(text).toContain('🔨 Ban');
    expect(text).toContain('Alasan');
    expect(text).toContain('*tidak disebutkan*');
    expect(text).toContain('DM ke target tidak terkirim (DM tertutup)');
  });

  it('katalog bahasa Indonesia dan renderer bawaan menghasilkan teks yang sama', () => {
    const record = moderationCase();
    const input = {
      action: 'warn' as const,
      caseNumber: 5,
      targetId: TARGET_ID,
      moderatorId: MODERATOR_ID,
      reason: 'Spam',
    };

    expect(embedText(moderationLogEmbed(input, id))).toBe(embedText(moderationLogEmbed(input)));
    expect(embedText(caseSummaryEmbed(record, {}, id))).toBe(embedText(caseSummaryEmbed(record)));
  });

  it('label aksi tetap kapital, dan hanya "Catatan" yang berubah jadi "Note"', () => {
    expect(actionLabel('ban')).toBe('Ban');
    expect(actionLabel('slowmode')).toBe('Slowmode');
    expect(actionLabel('note')).toBe('Catatan');
    expect(actionLabel('note', en)).toBe('Note');
  });

  it('urutan daftar jenis aksi tidak ikut berubah saat bahasa diganti', () => {
    const actions = ['warn', 'ban', 'timeout'] as const;
    const sorted = [...actions].sort(compareActions);

    // Kalau urutannya bergantung pada label, `Ban` dan `Timeout` akan tertukar
    // begitu server berbahasa Inggris.
    expect(sorted).toEqual(['ban', 'timeout', 'warn']);
    expect(compareActions('note', 'note')).toBe(0);
  });
});

/**
 * Perintah admin yang teksnya belum ikut diterjemahkan.
 *
 * Daftar ini bukan pembiaran, tapi inventaris: pengujian di bawah memverifikasi
 * bahwa daftarnya persis sama dengan berkas yang benar-benar masih punya
 * kalimat Indonesia. Begitu salah satu diterjemahkan, pengujian itu gagal dan
 * daftar di sini harus ikut diperkecil — jadi tidak ada perintah yang diam-diam
 * lolos dari penjaga.
 *
 * Sekarang kosong: `/customcommand`, `/reactionrole`, dan `/ticket` sudah
 * mengambil seluruh teksnya dari katalog, jadi penjaga ini berlaku penuh untuk
 * semua berkas perintah admin.
 */
const BELUM_DITERJEMAHKAN: string[] = [];

/**
 * Penjaga: tidak boleh ada kalimat Bahasa Indonesia yang ditulis langsung di
 * berkas perintah admin yang sudah ikut diterjemahkan.
 *
 * Heuristiknya sengaja kasar: pola yang cukup untuk menangkap kalimat yang
 * tertinggal, tanpa perlu memeriksa kata, ID fitur, atau format internal.
 */
describe('penjaga: tidak ada teks Indonesia yang tertinggal di perintah admin', () => {
  it('perintah yang sudah diterjemahkan mengambil teksnya dari katalog', async () => {
    const offenders = await indonesianCommandLiterals();

    expect(offenders.filter((entry) => !isPending(entry))).toEqual([]);
  });

  it('daftar perintah yang belum diterjemahkan sama persis dengan kenyataan', async () => {
    const offenders = await indonesianCommandLiterals();
    const actual = [...new Set(offenders.filter(isPending).map((entry) => basename(entry.file)))].sort();

    expect(actual).toEqual([...BELUM_DITERJEMAHKAN].sort());
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    // Kalau ini rapuh, penjaga di atas hanya rapi tapi tidak berguna: ia akan
    // lolos dalam keadaan kosong maupun dalam keadaan penuh teks.
    expect(looksIndonesian('User itu bukan anggota server ini, jadi tidak bisa di-kick.')).toBe(true);
    expect(looksIndonesian('Format kasus tidak dikenal. Contoh yang bisa dipakai adalah 7.')).toBe(
      true,
    );
    expect(looksIndonesian('Tidak ada pesan yang cocok dan tidak bisa dihapus dari channel ini.')).toBe(
      true,
    );

    expect(
      looksIndonesian('That user is not a member of this server, so they cannot be kicked.'),
    ).toBe(false);
    expect(looksIndonesian('moderation.ban')).toBe(false);
    expect(looksIndonesian('unknown')).toBe(false);

    expect(looksDutchOrCode('https://example.com/1')).toBe(true);
    expect(looksDutchOrCode('moderation.ban')).toBe(true);
    expect(looksDutchOrCode('Tidak ada apa pun di sini.')).toBe(false);

    // Nama hak akses mengandung spasi, jadi tidak tertangkap sebagai "kode" —
    // yang membuat penjaga lolos adalah panjangnya, bukan bentuknya.
    expect(looksDutchOrCode('Manage Server')).toBe(false);
    expect(looksIndonesian('Manage Server')).toBe(false);
  });
});

interface OffendingFile {
  file: string;
  literal: string;
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

function isPending(entry: OffendingFile): boolean {
  return BELUM_DITERJEMAHKAN.includes(basename(entry.file));
}

async function indonesianCommandLiterals(): Promise<OffendingFile[]> {
  const files = await listModuleFiles('src/commands/admin');
  const offenders: OffendingFile[] = [];

  for (const file of files) {
    for (const literal of stringLiterals(commandBody(readFileSync(file, 'utf8')))) {
      if (looksIndonesian(literal)) offenders.push({ file, literal });
    }
  }

  return offenders;
}

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