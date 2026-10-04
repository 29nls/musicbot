import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  CustomCommandValidationError,
  PLACEHOLDER_HELP,
  creatorLabel,
  customCommandDeletedEmbed,
  customCommandDetailEmbed,
  customCommandListEmbed,
  parseResponse,
  parseTriggerName,
  type CustomCommand,
} from '../src/modules/customcommands/index.js';
import { translator } from '../src/modules/i18n/index.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';

const id = translator('id');
const en = translator('en');

const USER_ID = '333333333333333333';

function commandRow(overrides: Partial<CustomCommand> = {}): CustomCommand {
  return {
    id: 1,
    guildId: '111111111111111111',
    name: 'ping',
    response: 'pong',
    createdBy: USER_ID,
    createdAt: new Date(1_700_000_000_000),
    updatedAt: new Date(1_700_000_000_000),
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

describe('perintah custom dalam bahasa Inggris', () => {
  it('daftar kosong menjelaskan cara membuat perintah dengan bahasa server', () => {
    const text = embedText(customCommandListEmbed([], en));

    expect(text).toContain('Custom Commands');
    expect(text).toContain('There are no custom commands yet');
    expect(text).toContain('/customcommand add');
    expect(text).toContain('!name');

    expect(text).not.toContain('Belum ada perintah custom');
  });

  it('daftar berisi menghitung perintah dan menerjemahkan judul field', () => {
    const text = embedText(
      customCommandListEmbed([commandRow(), commandRow({ id: 2, name: 'rules' })], en),
    );

    expect(text).toContain('2 commands');
    expect(text).toContain('Command list');
    expect(text).toContain('!ping');
    expect(text).toContain('Details & preview');
    expect(text).not.toContain('perintah');
  });

  it('detail memakai judul, field, dan label placeholder bahasa server', () => {
    const text = embedText(
      customCommandDetailEmbed(
        commandRow(),
        { text: 'pong untuk Rina', truncated: false },
        en,
      ),
    );

    expect(text).toContain('💬 !ping');
    expect(text).toContain('Created by');
    expect(text).toContain('Last edited');
    expect(text).toContain('Trigger it with');
    expect(text).toContain('Reply');
    expect(text).toContain('Preview');
    expect(text).toContain('Available placeholders');
    expect(text).toContain('mention of the caller');
    expect(text).toContain('text after the command name');

    expect(text).not.toContain('Dibuat oleh');
    expect(text).not.toContain('Pratinjau');
  });

  it('pratinjau yang terpotong punya labelnya sendiri', () => {
    const text = embedText(
      customCommandDetailEmbed(
        commandRow(),
        { text: 'pong yang sangat panjang', truncated: true },
        en,
      ),
    );

    expect(text).toContain('Preview (truncated)');
  });

  it('pembuat anonim diterjemahkan, mention tetap mention', () => {
    expect(creatorLabel('anon:abcdef0123', en)).toBe('Anonymous');
    expect(creatorLabel(USER_ID, en)).toBe(`<@${USER_ID}>`);
  });

  it('embed penghapusan memakai kalimat bahasa server', () => {
    const text = embedText(customCommandDeletedEmbed(commandRow(), en));

    expect(text).toContain('Command deleted');
    expect(text).toContain('`!ping` is no longer triggered');
    expect(text).toContain('Deleted by');

    expect(text).not.toContain('tidak lagi dipanggil');
  });

  it('pesan validasi tampil dalam bahasa server', () => {
    const tooLong = new CustomCommandValidationError('cc.err.nameTooLong', {
      max: 32,
      now: 40,
    });
    const reserved = new CustomCommandValidationError('cc.err.reserved', { name: '!play' });
    const pattern = new CustomCommandValidationError('cc.err.namePattern');
    const empty = new CustomCommandValidationError('cc.err.emptyResponse');

    expect(en(tooLong.key, tooLong.params)).toContain('at most 32 characters');
    expect(en(reserved.key, reserved.params)).toContain('`!play` cannot be used');
    expect(en(pattern.key)).toContain('must start with a letter');
    expect(en(empty.key)).toBe('The reply cannot be empty.');
  });
});

describe('perintah custom tanpa penerjemah', () => {
  it('nilai bawaannya persis bahasa Indonesia seperti sebelum ada i18n', () => {
    const text = embedText(
      customCommandDetailEmbed(commandRow(), { text: 'pong', truncated: false }),
    );

    expect(text).toContain('💬 !ping');
    expect(text).toContain('Dibuat oleh');
    expect(text).toContain('Balasan');
    expect(text).toContain('Pratinjau');
    expect(text).toContain('Placeholder yang bisa dipakai');
  });

  it('katalog Indonesia dan nilai bawaan menghasilkan teks yang sama', () => {
    expect(embedText(customCommandListEmbed([]))).toBe(embedText(customCommandListEmbed([], id)));
    expect(embedText(customCommandDeletedEmbed(commandRow()))).toBe(
      embedText(customCommandDeletedEmbed(commandRow(), id)),
    );
    expect(embedText(customCommandDetailEmbed(commandRow(), null))).toBe(
      embedText(customCommandDetailEmbed(commandRow(), null, id)),
    );
  });

  it('error validasi tetap membawa kalimat Indonesia di `message`', () => {
    expect(() => parseTriggerName('   ')).toThrow('Nama perintah tidak boleh kosong.');
    expect(() => parseTriggerName('play', { reserved: ['play'] })).toThrow(
      '`!play` tidak boleh dipakai',
    );
    expect(() => parseResponse('  ')).toThrow('Isi balasan tidak boleh kosong.');
  });
});

describe('penjaga: tidak ada teks Indonesia yang tertinggal di modul perintah custom', () => {
  it('label placeholder disimpan sebagai kunci katalog, bukan kalimat', () => {
    for (const item of PLACEHOLDER_HELP) {
      expect(item.token).toMatch(/^\{[a-z]+\}$/);
      expect(id(item.labelKey)).not.toBe(item.labelKey);
      expect(en(item.labelKey)).not.toBe(item.labelKey);
    }
  });

  it('literal Bahasa Indonesia di berkas yang sudah diterjemahkan tidak ada', async () => {
    const offenders = await indonesianLiterals();

    expect(offenders).toEqual([]);
  });

  it('judul dan nama field embed selalu lewat penerjemah', async () => {
    const offenders: string[] = [];

    for (const file of await listModuleFiles('src/modules/customcommands')) {
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

  it('pesan error di perintah tidak pernah ditulis langsung', () => {
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
    const files = (await listModuleFiles('src/modules/customcommands'))
      .map((file) => basename(file))
      .filter((name) => name.endsWith('.ts'));

    const covered = files.filter((name) => SUDAH_DITERJEMAHKAN.includes(name));
    expect([...covered].sort()).toEqual([...SUDAH_DITERJEMAHKAN].sort());
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    expect(looksIndonesian('Balasan perintah itu sudah diperbarui, panggil dengan !ping')).toBe(
      true,
    );
    expect(looksIndonesian('Perintah ini butuh izin Manage Server untuk dipakai di sini.')).toBe(
      true,
    );

    expect(looksIndonesian('Command list')).toBe(false);
    expect(looksIndonesian('Last edited')).toBe(false);
    expect(looksIndonesian('cc.err.notFound')).toBe(false);

    expect(looksCode('cc.err.notFound')).toBe(true);
    expect(looksCode('https://example.com/1')).toBe(true);
    expect(looksCode('Balasan perintah custom')).toBe(false);
  });
});

/**
 * Berkas modul perintah custom yang teks runtime-nya sudah ikut katalog.
 *
 * Diverifikasi oleh tes di bawah: begitu satu berkas kehilangan penjaga,
 * daftarnya harus ikut diperkecil, dan begitu satu berkas menambah kalimat
 * Indonesia baru, tesnya gagal.
 *
 * `service.ts`, `repository.ts`, dan sisanya sengaja tidak masuk: teksnya hanya
 * untuk logger internal, bukan untuk member.
 */
const SUDAH_DITERJEMAHKAN = ['embeds.ts', 'trigger.ts', 'validation.ts'];

/** Perintah yang menyusun embed error; argumennya wajib lewat `t`. */
const COMMAND_FILES = ['src/commands/admin/customcommand.ts'];

interface OffendingFile {
  file: string;
  literal: string;
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

async function indonesianLiterals(): Promise<OffendingFile[]> {
  const files = await listModuleFiles('src/modules/customcommands');
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
