import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  ReactionRoleEmptyError,
  ReactionRoleValidationError,
  describePanelLifetime,
  panelClosedEmbed,
  panelEmbed,
  panelListEmbed,
  panelUpdatedEmbed,
  parsePanelDuration,
  parseRoleMentions,
  type ReactionRolePanel,
} from '../src/modules/reactionroles/index.js';
import { translator } from '../src/modules/i18n/index.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';

const id = translator('id');
const en = translator('en');

const GUILD_ID = '123456789012345678';
const ROLE_A = '222222222222222222';
const ROLE_B = '333333333333333333';
const CHANNEL_ID = '444444444444444444';

const names = new Map([
  [ROLE_A, 'Pemain'],
  [ROLE_B, 'Penggemar'],
]);

function panel(overrides: Partial<ReactionRolePanel> = {}): ReactionRolePanel {
  return {
    id: 1,
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    messageId: '555555555555555555',
    expiresAt: null,
    closedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    options: [
      {
        id: 1,
        panelId: 1,
        roleId: ROLE_A,
        label: 'Pemain',
        emoji: null,
        description: null,
        position: 0,
      },
      {
        id: 2,
        panelId: 1,
        roleId: ROLE_B,
        label: null,
        emoji: null,
        description: null,
        position: 1,
      },
    ],
    ...overrides,
  };
}

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

describe('panel reaction role dalam bahasa Inggris', () => {
  it('embed panel memakai judul, petunjuk, dan footer bahasa server', () => {
    const text = embedText(panelEmbed(panel(), names, undefined, en));

    expect(text).toContain('Pick Your Own Role');
    expect(text).toContain('Pick a role below to get it');
    expect(text).toContain('remove it');
    expect(text).toContain('Ask the server moderators');
    expect(text).toContain('Panel #1');
    expect(text).toContain('2 roles available');
    expect(text).toContain('no lifetime');
    expect(text).toContain('Pemain');

    expect(text).not.toContain('Pilih role di bawah');
    expect(text).not.toContain('role tersedia');
  });

  it('deskripsi admin tetap dipakai apa adanya', () => {
    const text = embedText(panelEmbed(panel(), names, 'Pick a cool role here.', en));

    expect(text).toContain('Pick a cool role here.');
    expect(text).not.toContain('Pick a role below to get it');
  });

  it('role yang hilang dari cache diberi label bahasa server', () => {
    const text = embedText(panelEmbed(panel(), new Map(), undefined, en));

    expect(text).toContain('Role not found');
  });

  it('panel tertutup menyebut alasannya dalam bahasa server', () => {
    const expired = embedText(
      panelClosedEmbed(panel({ closedAt: new Date() }), en('rr.close.reason.expired'), en),
    );
    const manual = embedText(
      panelClosedEmbed(panel({ closedAt: new Date() }), en('rr.close.reason.manual'), en),
    );

    expect(expired).toContain('This Panel Is Closed');
    expect(expired).toContain('had a lifetime and it has ended');
    expect(expired).toContain('the select menu has been removed');
    expect(manual).toContain('closed manually by a server moderator');

    expect(expired).not.toContain('sudah habis');
  });

  it('daftar panel memakai status dan kalimat bahasa server', () => {
    const text = embedText(panelListEmbed([panel()], en));

    expect(text).toContain('Reaction Role Panels');
    expect(text).toContain('2 roles');
    expect(text).toContain('active');
    expect(text).toContain(CHANNEL_ID);

    expect(embedText(panelListEmbed([], en))).toContain('No panels yet');
  });

  it('embed hasil tambah/hapus role mengikuti bahasa server', () => {
    const text = embedText(panelUpdatedEmbed(panel(), en('rr.updated.added', { roles: '@X' }), en));

    expect(text).toContain('Reaction Role Panel Updated');
    expect(text).toContain('Added: @X.');
    expect(text).toContain('now has 2 roles');
  });

  it('masa hidup ditulis dalam bahasa server', () => {
    expect(describePanelLifetime(7 * 86_400_000, en)).toBe('7 days');
    expect(describePanelLifetime(6 * 3_600_000, en)).toBe('6 hours');
    expect(describePanelLifetime(30 * 60_000, en)).toBe('30 minutes');
    expect(describePanelLifetime(0, en)).toBe('0 minutes');
  });

  it('pesan validasi tampil dalam bahasa server', () => {
    const tooMany = new ReactionRoleValidationError('rr.err.tooManyOptions', {
      max: 25,
      total: 26,
    });
    const noRoles = new ReactionRoleValidationError('rr.err.noRoles');
    const unreadable = new ReactionRoleValidationError('rr.err.unreadableRoles');
    const unit = new ReactionRoleValidationError('rr.err.durationUnit', { unit: 'minggu' });
    const empty = new ReactionRoleEmptyError('rr.err.allRolesInPanel');

    expect(en(tooMany.key, tooMany.params)).toContain('at most 25 roles');
    expect(en(noRoles.key)).toContain('at least one role');
    expect(en(unreadable.key)).toContain('autocomplete');
    expect(en(unit.key, unit.params)).toContain('Unknown unit `minggu`');
    expect(en(empty.key)).toBe('All of those roles are already in this panel.');
  });
});

describe('panel reaction role tanpa penerjemah', () => {
  it('nilai bawaannya persis bahasa Indonesia seperti sebelum ada i18n', () => {
    const text = embedText(panelEmbed(panel(), names));

    expect(text).toContain('Ambil Role Sendiri');
    expect(text).toContain('Pilih role di bawah');
    expect(text).toContain('role tersedia');
    expect(text).toContain('tanpa masa hidup');
  });

  it('katalog Indonesia dan nilai bawaan menghasilkan teks yang sama', () => {
    expect(embedText(panelEmbed(panel(), names))).toBe(embedText(panelEmbed(panel(), names, null, id)));
    expect(embedText(panelListEmbed([panel()]))).toBe(embedText(panelListEmbed([panel()], id)));
    expect(embedText(panelUpdatedEmbed(panel(), 'Ditambahkan: @X.'))).toBe(
      embedText(panelUpdatedEmbed(panel(), 'Ditambahkan: @X.', id)),
    );
    expect(describePanelLifetime(2 * 3_600_000)).toBe(describePanelLifetime(2 * 3_600_000, id));
  });

  it('error validasi tetap membawa kalimat Indonesia di `message`', () => {
    expect(() => parseRoleMentions('')).toThrow('Sebutkan minimal satu role');
    expect(() => parsePanelDuration('seminggu')).toThrow('tidak terbaca');
    expect(() => parsePanelDuration('5m')).toThrow('minimal 10 menit');
    expect(() => parsePanelDuration('400d')).toThrow('maksimal 365 hari');
  });
});

describe('penjaga: tidak ada teks Indonesia yang tertinggal di modul reaction role', () => {
  it('literal Bahasa Indonesia di berkas yang sudah diterjemahkan tidak ada', async () => {
    const offenders = await indonesianLiterals();

    expect(offenders).toEqual([]);
  });

  it('judul dan nama field embed selalu lewat penerjemah', async () => {
    const offenders: string[] = [];

    for (const file of await listModuleFiles('src/modules/reactionroles')) {
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

  it('embed balasan tidak pernah menerima kalimat jadi', () => {
    // Handler select menu dan perintah sama-sama menyusun embed; keduanya harus
    // lewat `t`, bukan literal. Literal di sini persis kelas bug yang sapuan ini
    // hilangkan.
    const offenders: string[] = [];
    const files = [
      'src/modules/reactionroles/select.ts',
      'src/commands/admin/reactionrole.ts',
    ];

    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(
        /(?:warningEmbed|successEmbed|infoEmbed|errorEmbed)\(\s*'([^']*)'/g,
      )) {
        offenders.push(basename(file) + ' -> ' + match[0]);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('daftar berkas yang sudah diterjemahkan sama persis dengan kenyataan', async () => {
    const files = (await listModuleFiles('src/modules/reactionroles'))
      .map((file) => basename(file))
      .filter((name) => name.endsWith('.ts'));

    const covered = files.filter((name) => SUDAH_DITERJEMAHKAN.includes(name));
    expect([...covered].sort()).toEqual([...SUDAH_DITERJEMAHKAN].sort());
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    expect(looksIndonesian('Panel ini sudah ditutup, jadi role-nya tidak bisa diambil lagi.')).toBe(
      true,
    );
    expect(looksIndonesian('Pilih role yang ingin kamu ambil dari server ini.')).toBe(true);

    expect(looksIndonesian('Pick the role you want')).toBe(false);
    expect(looksIndonesian('Role not found')).toBe(false);
    expect(looksIndonesian('rr.select.placeholder')).toBe(false);

    expect(looksCode('rr.select.placeholder')).toBe(true);
    expect(looksCode('https://example.com/1')).toBe(true);
    expect(looksCode('Panel reaction role')).toBe(false);
  });
});

/**
 * Berkas modul reaction role yang teks runtime-nya sudah ikut katalog.
 *
 * Diverifikasi oleh tes di bawah: begitu satu berkas kehilangan penjaga,
 * daftarnya harus ikut diperkecil, dan begitu satu berkas menambah kalimat
 * Indonesia baru, tesnya gagal.
 *
 * `repository.ts`, `mapping.ts`, `singleton.ts`, dan `index.ts` sengaja tidak
 * masuk: teksnya hanya untuk logger internal, bukan untuk member. `types.ts`
 * memuat alias durasi berbahasa Indonesia (`permanen`, `hari`) yang memang
 * **input** yang diterima, bukan kalimat yang ditampilkan.
 */
const SUDAH_DITERJEMAHKAN = [
  'embeds.ts',
  'errors.ts',
  'expire.ts',
  'select.ts',
  'service.ts',
  'validation.ts',
];

interface OffendingFile {
  file: string;
  literal: string;
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

async function indonesianLiterals(): Promise<OffendingFile[]> {
  const files = await listModuleFiles('src/modules/reactionroles');
  const offenders: OffendingFile[] = [];

  for (const file of files) {
    const name = basename(file);
    if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

    const source = stripComments(readFileSync(file, 'utf8'));
    for (const literal of [...stringLiterals(source), ...templateFragments(source)]) {
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

/** Kata penanda kalimat Bahasa Indonesia. */
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

  return hits >= 2;
}
