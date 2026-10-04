import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { COMMAND_CATEGORIES } from '../src/config/constants.js';
import {
  ConfigValidationError,
  moduleDescription,
  moduleLabel,
  renderConfigEmbed,
  toConfigErrorEmbed,
  type GuildConfig,
} from '../src/modules/config/index.js';
import { translator, translatorForGuild } from '../src/modules/i18n/index.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';
import { commandCategoryLabel, uptimeText } from '../src/commands/core/_shared.js';

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

function config(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: 'guild-1',
    logChannelId: null,
    welcomeChannelId: null,
    goodbyeChannelId: null,
    djRoleId: null,
    autoroleId: null,
    autoroleBotId: null,
    welcomeMessage: null,
    goodbyeMessage: null,
    defaultVolume: 100,
    idleTimeoutSec: 300,
    ticketPanelChannelId: null,
    ticketCategoryId: null,
    ticketStaffRoleId: null,
    ticketPanelMessageId: null,
    stayChannelId: null,
    modules: {
      music: true,
      moderation: true,
      automod: false,
      logging: false,
      reactions: false,
      tickets: false,
      customCommands: false,
    },
    locale: 'id',
    ...overrides,
  };
}

describe('perintah inti dalam dua bahasa', () => {
  it('ringkasan konfigurasi memakai nama field bahasa server', () => {
    const embed = renderConfigEmbed(config(), '⚙️ Konfigurasi Server', id);
    const text = embedText(embed);

    expect(text).toContain(id('config.field.logChannel'));
    expect(text).toContain(id('config.field.modules'));
    expect(text).toContain(id('config.value.notSet'));

    const english = embedText(renderConfigEmbed(config(), en('config.embed.title'), en));
    expect(english).toContain(en('config.field.logChannel'));
    expect(english).toContain(en('config.field.modules'));
    expect(english).toContain(en('config.value.notSet'));
    expect(english).not.toContain(id('config.field.logChannel'));
  });

  it('nilai turunan ikut bahasa: detik, channel 24/7, dan daftar modul', () => {
    const filled = config({ stayChannelId: '123456789012345678' });
    const english = embedText(renderConfigEmbed(filled, en('config.embed.title'), en));

    expect(english).toContain(en('config.value.seconds', { count: 300 }));
    expect(english).toContain(en('config.value.stayActive', { channel: '<#123456789012345678>' }));

    // Tanpa channel 24/7 tampil bentuk sebaliknya, jadi keduanya ikut diperiksa.
    const empty = embedText(renderConfigEmbed(config(), en('config.embed.title'), en));
    expect(empty).toContain(en('config.value.stayOff', { none: en('config.value.notSet') }));
    expect(english).toContain(en('config.module.music.label'));
  });

  it('judul embed dikirim pemanggil, jadi /setup bisa punya judul sendiri', () => {
    expect(embedText(renderConfigEmbed(config(), en('setup.embed.title'), en))).toContain(
      en('setup.embed.title'),
    );
    expect(embedText(renderConfigEmbed(config(), id('config.embed.title'), id))).toContain(
      id('config.embed.title'),
    );
  });

  it('label dan deskripsi modul untuk select menu /setup ikut bahasa', () => {
    expect(moduleLabel('tickets', id)).toBe(id('config.module.tickets.label'));
    expect(moduleLabel('tickets', en)).toBe(en('config.module.tickets.label'));
    expect(moduleDescription('music', en)).toBe(en('config.module.music.description'));
    expect(moduleLabel('music')).toBe(id('config.module.music.label'));
  });

  it('error konfigurasi disusun dari kunci katalog, bukan kalimat tersimpan', () => {
    const error = new ConfigValidationError('config.err.invalid', { details: '• `volume`: wajib' });

    expect(error.message).toBe(id('config.err.invalid', { details: '• `volume`: wajib' }));

    const embed = toConfigErrorEmbed(error, en);
    const text = embedText(embed);
    expect(text).toContain(en('config.err.invalidTitle'));
    expect(text).toContain(en('config.err.invalid', { details: '• `volume`: wajib' }));

    expect(embedText(toConfigErrorEmbed(new Error('x'), en))).toContain(en('config.err.generic'));
  });

  it('label kategori /help sama dengan label Indonesia di konstanta', () => {
    for (const category of Object.keys(COMMAND_CATEGORIES) as (keyof typeof COMMAND_CATEGORIES)[]) {
      expect(commandCategoryLabel(category, id)).toBe(COMMAND_CATEGORIES[category].label);
      expect(commandCategoryLabel(category, en)).toBe(en(`help.category.${category}` as never));
    }
  });

  it('uptime disusun dari satuan bahasa server', () => {
    expect(uptimeText(3_723_000, id)).toBe('1 jam 2 menit');
    expect(uptimeText(90_000_000, id)).toBe('1 hari 1 jam');
    expect(uptimeText(45_000, id)).toBe('45 detik');
    expect(uptimeText(0, id)).toBe('baru saja');

    expect(uptimeText(3_723_000, en)).toBe('1 hour 2 minutes');
    expect(uptimeText(90_000_000, en)).toBe('1 day 1 hour');
    expect(uptimeText(45_000, en)).toBe('45 seconds');
    expect(uptimeText(0, en)).toBe('just now');

    expect(uptimeText(-5, id)).toBe('baru saja');
    expect(uptimeText(Number.NaN, en)).toBe('just now');
  });

  it('perintah tanpa server memakai bahasa bawaan, bukan error', async () => {
    const t = await translatorForGuild(null);

    expect(t('embed.title.error')).toBe(id('embed.title.error'));
    expect(t('ping.uptime.seconds', { count: 5 })).toBe(id('ping.uptime.seconds', { count: 5 }));
  });
});

describe('penjaga: judul bawaan embed tidak pernah bocor ke server English', () => {
  it('tidak ada pemanggil embed satu argumen di seluruh src', async () => {
    const files = await listModuleFiles('src');
    const offenders: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      offenders.push(...singleArgumentEmbedCalls(file, source));
    }

    expect(offenders).toEqual([]);
  });

  it('judul embed selalu lewat penerjemah, bukan literal', async () => {
    const files = await listModuleFiles('src');
    const offenders: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/(?:warningEmbed|successEmbed|infoEmbed|errorEmbed)\(\s*'([^']*)'/g)) {
        offenders.push(file + ' -> ' + match[0]);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('heurutannya benar: embed judul tetap boleh, satu argumen tidak', () => {
    const source = stripComments(
      [
        "const a = errorEmbed(t('x.err'), t('embed.title.error'));",
        "const b = warningEmbed(t('x.warn'), t('embed.title.warning'));",
      ].join('\n'),
    );
    expect(singleArgumentEmbedCalls('contoh.ts', source)).toEqual([]);

    const bad = stripComments("const c = errorEmbed(t('x.err'));");
    expect(singleArgumentEmbedCalls('contoh.ts', bad)).toHaveLength(1);
  });
});

describe('penjaga: tidak ada teks Indonesia yang tertinggal di modul config', () => {
  it('literal Bahasa Indonesia di berkas yang sudah diterjemahkan tidak ada', async () => {
    const offenders = await indonesianLiterals();

    expect(offenders).toEqual([]);
  });

  it('judul dan nama field embed selalu lewat penerjemah', async () => {
    // **Kenapa cek terpisah dari heuristik kalimat.** `'\U0001F50A Volume default'`
    // cuma 16 karakter dan tidak punya kata penanda, jadi heuristik yang menuntut
    // >= 15 karakter dan dua stopword melewatinya. Yang bisa membedakan cuma satu
    // hal: apakah nilainya datang dari penerjemah atau dari literal.
    const offenders: string[] = [];

    for (const file of await listModuleFiles('src/modules/config')) {
      const name = basename(file);
      if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of [/setTitle\(\s*'([^']*)'/g, /(?:title|name):\s*'([^']*)'/g]) {
        for (const match of code.matchAll(pattern)) {
          offenders.push(name + ' -> ' + match[0]);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('daftar berkas yang sudah diterjemahkan sama persis dengan kenyataan', async () => {
    const files = (await listModuleFiles('src/modules/config'))
      .map((file) => basename(file))
      .filter((name) => name.endsWith('.ts'));

    const covered = files.filter((name) => SUDAH_DITERJEMAHKAN.includes(name));
    expect([...covered].sort()).toEqual([...SUDAH_DITERJEMAHKAN].sort());
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    expect(looksIndonesian('Konfigurasi diperbarui dan langsung berlaku tanpa restart bot.')).toBe(
      true,
    );
    expect(looksIndonesian('Setup dibatalkan dan tidak ada perubahan yang disimpan.')).toBe(true);

    expect(looksIndonesian('Configuration updated and applied right away')).toBe(false);
    expect(looksIndonesian('config.cmd.updated')).toBe(false);
    expect(looksIndonesian('Not set')).toBe(false);

    expect(looksCode('config.cmd.updated')).toBe(true);
    expect(looksCode('https://example.com/1')).toBe(true);
    expect(looksCode('Konfigurasi diperbarui')).toBe(false);
  });
});

/**
 * Berkas modul config yang teks runtime-nya sudah ikut katalog.
 *
 * `repository.ts`, `mapping.ts`, `guildConfigService.ts`, dan `index.ts` tidak
 * masuk: mereka tidak menyusun teks untuk member.
 */
const SUDAH_DITERJEMAHKAN = ['embeds.ts', 'errors.ts', 'labels.ts', 'types.ts', 'validation.ts'];

/**
 * Pesan zod masih Bahasa Indonesia.
 *
 * Skema dibangun sekali saat modul dimuat, bukan per bahasa server, jadi
 * kalimatnya tidak bisa mengikuti `t`. Ini batas yang diketahui, bukan hal yang
 * tersembunyi: `/config` tidak bisa mengirim nilai yang/message di luar batas
 * yang sudah dibatasi option-nya, jadi kalimat ini hanya muncul kalau ada yang
 * menulis patch langsung.
 */
const DILEHKAN: Record<string, string[]> = {
  'validation.ts': ['harus berupa ID Discord', 'karakter', 'maksimal', 'minimal', 'detik', 'nilai konfigurasi'],
};

interface OffendingFile {
  file: string;
  literal: string;
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

async function indonesianLiterals(): Promise<OffendingFile[]> {
  const files = await listModuleFiles('src/modules/config');
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

const EMBED_BUILDERS = ['errorEmbed', 'successEmbed', 'warningEmbed'] as const;

/**
 * Pemanggil embed yang hanya menerima deskripsi.
 *
 * `errorEmbed(judul?)` punya judul bawaan berbahasa Indonesia, jadi pemanggilan
 * satu argumen diam-diam membocorkan "❌ Terjadi Kesalahan" ke server English.
 * Pencocokan memakai kedalaman kurung, bukan regex, karena argumennya boleh
 * berisi kurung sendiri.
 */
function singleArgumentEmbedCalls(file: string, source: string): string[] {
  const offenders: string[] = [];

  for (const builder of EMBED_BUILDERS) {
    const pattern = new RegExp(`(?<![\\w.])${builder}\\(`, 'g');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source)) !== null) {
      const open = match.index + match[0].length - 1;
      const close = closingParen(source, open);
      if (close === -1) throw new Error(`kurung tidak berpasangan di ${file}: ${match[0]}`);

      const args = source.slice(open + 1, close);
      if (args.trim() && !hasTopLevelComma(args)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} ${builder}(${args.trim().slice(0, 40)})`);
      }

      pattern.lastIndex = close + 1;
    }
  }

  return offenders;
}

function closingParen(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = open; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function hasTopLevelComma(args: string): boolean {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];

    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) return true;
  }

  return false;
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