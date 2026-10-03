import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  AutomodValidationError,
  actionLabel,
  analyzeMessage,
  automodLogEmbed,
  automodShowEmbed,
  buildPolicy,
  describeThreshold,
  ruleDescription,
  ruleLabel,
  toAutomodErrorEmbed,
  type AutomodMessageInput,
  type AutomodPolicy,
  type AutomodState,
} from '../src/modules/automod/index.js';
import { translator } from '../src/modules/i18n/index.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';

const id = translator('id');
const en = translator('en');

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

function policy(overrides: Partial<AutomodPolicy> = {}): AutomodPolicy {
  return { ...buildPolicy('guild-1', []), ...overrides };
}

function message(overrides: Partial<AutomodMessageInput> = {}): AutomodMessageInput {
  return {
    channelId: 'channel-1',
    content: 'halo semua',
    mentionCount: 0,
    memberRoleIds: [],
    canManageMessages: false,
    isBot: false,
    ...overrides,
  };
}

const state = (overrides: Partial<AutomodState> = {}): AutomodState => ({
  recentMessageCount: 1,
  duplicateStreak: 1,
  ...overrides,
});

/** Pesan yang memicu tiap rule, dipakai untuk memeriksa alasan. */
const TRIGGERS: Array<{ rule: string; input: AutomodMessageInput; state?: Partial<AutomodState> }> = [
  { rule: 'spam', input: message(), state: { recentMessageCount: 9 } },
  { rule: 'invite', input: message({ content: 'join discord.gg/abc123' }) },
  { rule: 'link', input: message({ content: 'lihat https://example.com/x' }) },
  { rule: 'mention', input: message({ mentionCount: 9 }) },
  { rule: 'caps', input: message({ content: 'INI PESAN YANG SANGAT KERAS' }) },
  { rule: 'duplicate', input: message(), state: { duplicateStreak: 5 } },
];

describe('automod dalam bahasa Inggris', () => {
  it('label rule dan deskripsinya mengikuti bahasa server', () => {
    expect(ruleLabel('spam')).toBe('Anti-spam');
    expect(ruleLabel('spam', en)).toBe('Anti-spam');
    expect(ruleLabel('badword', en)).toBe('Bad words');
    expect(ruleLabel('duplicate', en)).toBe('Anti-duplicate');

    expect(ruleDescription('spam', en)).toContain('5 seconds');
    expect(ruleDescription('caps', en)).toContain('capital letters');
    expect(ruleDescription('spam')).toContain('detik');
  });

  it('label aksi mengikuti bahasa server', () => {
    expect(actionLabel('delete')).toBe('Hapus pesan');
    expect(actionLabel('delete', en)).toBe('Delete message');
    expect(actionLabel('warn', en)).toBe('Record a warning');
    expect(actionLabel('timeout', en)).toBe('Timeout');
  });

  it('ambang diterjemahkan tanpa menyalin angka detik ke katalog', () => {
    expect(describeThreshold('spam', 5)).toBe('5 pesan / 5 detik');
    expect(describeThreshold('spam', 5, en)).toBe('5 messages / 5 seconds');
    expect(describeThreshold('caps', 70, en)).toBe('70% capital letters');
    expect(describeThreshold('duplicate', 3, en)).toBe('3x in a row');
    expect(describeThreshold('badword', 0, en)).toBe('—');
  });

  it('alasan pelanggaran yang ditampilkan mengikuti bahasa server', () => {
    for (const trigger of TRIGGERS) {
      const foundEn = analyzeMessage(
        trigger.input,
        policy(),
        state(trigger.state),
        en,
      );
      const foundId = analyzeMessage(trigger.input, policy(), state(trigger.state));

      expect(foundEn?.rule, trigger.rule).toBe(trigger.rule);
      expect(foundId?.rule, trigger.rule).toBe(trigger.rule);

      // Alasan bahasa Inggris tidak boleh sama dengan bahasa Indonesia, kecuali
      // kebetulan kata yang sama memang dipakai di dua bahasa.
      expect(foundEn?.reason, trigger.rule).not.toBe(foundId?.reason);
      expect(foundEn?.reason.length, trigger.rule).toBeGreaterThan(0);
    }
  });

  it('embed /automod show memakai judul, field, dan footer bahasa server', () => {
    const text = embedText(automodShowEmbed(policy(), true, en));

    expect(text).toContain('🤖 Automod');
    expect(text).toContain('The automod module is **on**');
    expect(text).toContain('Rules');
    expect(text).toContain('Exempt channels');
    expect(text).toContain('Banned words');
    expect(text).toContain('Allowed domains');
    expect(text).toContain('Message authors with Manage Messages');
    expect(text).not.toContain('Kata terlarang');
    expect(text).not.toContain('belum ada');
  });

  it('embed /automod show versi mati menjelaskan cara menyalakan', () => {
    const text = embedText(automodShowEmbed(policy(), false, en));

    expect(text).toContain('The automod module is **off**');
    expect(text).toContain('/config set automod:true');
  });

  it('embed log pelanggaran memakai nama field dan aksi bahasa server', () => {
    const text = embedText(
      automodLogEmbed(
        {
          violation: { rule: 'mention', actions: ['delete', 'timeout'], observed: 9, reason: 'x' },
          authorId: '111111111111111111',
          authorTag: 'spammer#0001',
          channelId: '222222222222222222',
          content: 'halo',
          caseNumber: 142,
          timeoutMs: 600_000,
        },
        en,
      ),
    );

    expect(text).toContain('🤖 Automod — 📣 Anti-mention spam');
    expect(text).toContain('User');
    expect(text).toContain('Actions');
    expect(text).toContain('Reason');
    expect(text).toContain('Case');
    expect(text).toContain('Message content');
    expect(text).toContain('Timeout for 10 minutes');
    expect(text).not.toContain('Pengguna');
    expect(text).not.toContain('10 menit');
  });

  it('error validasi disusun dari kunci katalog, bukan kalimat tersimpan', () => {
    const error = new AutomodValidationError('automod.err.invalidId', {
      label: 'channel',
      value: 'bukan-id',
    });

    // `message` tetap bahasa Indonesia supaya log & `toThrow` tidak kosong.
    expect(error.message).toContain('tidak valid');

    const text = embedText(toAutomodErrorEmbed(error, en));
    expect(text).toContain('The channel ID is not valid: `bukan-id`.');
    expect(text).toContain('Automod Settings Rejected');
    expect(text).not.toContain('tidak valid');
  });

  it('error database mati dan error umum diterjemahkan', () => {
    expect(embedText(toAutomodErrorEmbed(new Error('ECONNREFUSED'), en))).toContain(
      'The database cannot be reached',
    );
    expect(embedText(toAutomodErrorEmbed(new Error('boom'), en))).toContain(
      'Something went wrong while accessing the automod settings',
    );
  });
});

describe('automod tanpa penerjemah', () => {
  it('nilai bawaannya persis bahasa Indonesia seperti sebelum ada i18n', () => {
    const text = embedText(automodShowEmbed(policy(), true));

    expect(text).toContain('Modul automod **aktif**');
    expect(text).toContain('Rule');
    expect(text).toContain('🚫 Channel dikecualikan');
    expect(text).toContain('🤬 Kata terlarang');
    expect(text).toContain('*belum ada*');
    expect(text).toContain('Pemilik pesan dengan Manage Messages');
  });

  it('katalog Indonesia dan nilai bawaan menghasilkan teks yang sama', () => {
    expect(embedText(automodShowEmbed(policy(), true))).toBe(
      embedText(automodShowEmbed(policy(), true, id)),
    );
    expect(embedText(automodLogEmbed({
      violation: { rule: 'spam', actions: ['delete'], observed: 9, reason: 'x' },
      authorId: '111111111111111111',
      authorTag: 'x#0001',
      channelId: '222222222222222222',
      content: 'halo',
    }))).toBe(
      embedText(automodLogEmbed({
        violation: { rule: 'spam', actions: ['delete'], observed: 9, reason: 'x' },
        authorId: '111111111111111111',
        authorTag: 'x#0001',
        channelId: '222222222222222222',
        content: 'halo',
      }, id)),
    );
  });

  it('label rule bahasa Indonesia tidak bergeser', () => {
    expect(ruleLabel('spam')).toBe('Anti-spam');
    expect(ruleLabel('mention')).toBe('Anti-mention-spam');
    expect(ruleLabel('badword')).toBe('Badword');
    expect(actionLabel('delete')).toBe('Hapus pesan');
    expect(describeThreshold('mention', 5)).toBe('5 mention / pesan');
  });
});

/**
 * Berkas modul automod yang teks runtime-nya sudah ikut katalog.
 *
 * Diverifikasi oleh tes di bawah: begitu satu berkas kehilangan penjaga,
 * daftarnya harus ikut diperkecil, dan begitu satu berkas menambah kalimat
 * Indonesia baru, tesnya gagal.
 */
const SUDAH_DITERJEMAHKAN = [
  'embeds.ts',
  'engine.ts',
  'errors.ts',
  'types.ts',
  'validation.ts',
];

/**
 * Berkas yang memang masih boleh berisi kalimat Indonesia.
 *
 * `service.ts` hanya menyimpan data mentah (id, kata, domain) dan melempar
 * error ber-kunci; kalimatnya hidup di `validation.ts`. `repository.ts` dan
 * `mapping.ts` tidak menyentuh teks yang dibaca user sama sekali.
 */
const DILEHKAN: Record<string, string[]> = {};

describe('penjaga: tidak ada teks Indonesia yang tertinggal di modul automod', () => {
  it('literal Bahasa Indonesia di berkas yang sudah diterjemahkan tidak ada', async () => {
    const offenders = await indonesianLiterals();

    expect(offenders).toEqual([]);
  });

  it('judul dan nama field embed selalu lewat penerjemah', async () => {
    // **Kenapa cek terpisah dari heuristik kalimat.** Judul seperti
    // `'🤖 Automod'` hanya 10 karakter, jadi sengaja dilewati heuristik yang
    // menuntut >= 15 karakter, DAN teksnya sama di kedua bahasa sehingga tes
    // render tidak bisa membedakannya. Yang bisa membedakan cuma satu hal:
    // apakah nilainya datang dari penerjemah atau dari literal. Judul dan nama
    // field adalah tempat paling mungkin seseorang menulis literal kembali,
    // jadi keduanya diperiksa langsung.
    const offenders: string[] = [];

    for (const file of await listModuleFiles('src/modules/automod')) {
      const name = basename(file);
      if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      // Dua bentuk: pemanggilan builder (`.setTitle('…')`) dan properti objek
      // field (`{ name: '…' }` / `{ title: '…' }`). Keduanya harus tertangkap --
      // versi pertama regex ini hanya menangkap bentuk ber-kolon, dan sabotase
      // pada `.setTitle('…')` lolos karenanya.
      const patterns = [/setTitle\(\s*'([^']*)'/g, /(?:title|name):\s*'([^']*)'/g];
      for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) {
          offenders.push(name + ' -> ' + match[0]);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('daftar berkas yang sudah diterjemahkan sama persis dengan kenyataan', async () => {
    const files = (await listModuleFiles('src/modules/automod'))
      .map((file) => basename(file))
      .filter((name) => name.endsWith('.ts'));

    const covered = files.filter((name) => SUDAH_DITERJEMAHKAN.includes(name));
    expect([...covered].sort()).toEqual([...SUDAH_DITERJEMAHKAN].sort());
  });

  it('heuristiknya melewatkan judul pendek, dan itu memang batasnya', () => {
    // Ditulis terang supaya batas ini tidak dilupakan: heuristik kalimat TIDAK
    // bisa diandalkan untuk judul pendek seperti `'🤖 Automod'`. Tes "judul dan
    // nama field selalu lewat penerjemah" di atas yang menutup celah itu.
    expect(looksIndonesian('🤖 Automod')).toBe(false);
    expect(looksIndonesian('Banned words')).toBe(false);
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    expect(looksIndonesian('Kata terlarang harus 2–50 karakter dan tanpa baris baru.')).toBe(true);
    expect(looksIndonesian('Domain tidak boleh kosong sama sekali di sini.')).toBe(true);

    expect(looksIndonesian('Anti-spam')).toBe(false);
    expect(looksIndonesian('Delete message')).toBe(false);
    expect(looksIndonesian('automod.rule.spam.label')).toBe(false);
    expect(looksIndonesian('Banned words')).toBe(false);

    expect(looksCode('automod.err.invalidId')).toBe(true);
    expect(looksCode('https://example.com/1')).toBe(true);
    expect(looksCode('Kata terlarang harus panjang.')).toBe(false);
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
  const files = await listModuleFiles('src/modules/automod');
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