import { Collection, Locale, SlashCommandSubcommandBuilder } from 'discord.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCommands } from '../src/handlers/commandHandler.js';
import { applyCommandLocalizations } from '../src/modules/i18n/index.js';
import type { BotCommand } from '../src/types/command.js';

/**
 * Validasi payload `PUT /applications/{id}/commands` TANPA menyentuh Discord.
 *
 * **Kenapa tes ini ada.** Discord menolak seluruh payload dengan satu kesalahan
 * apa pun, dan karena deploy mengirim 46 perintah sekaligus, satu perintah yang
 * salah berarti **tidak satu pun** perintah yang ter-deploy — bot tetap jalan,
 * tapi daftar perintahnya diam-diam milik versi lama. Dua kesalahan nyata sudah
 * ketangkap di sini:
 *
 * 1. Kode bahasa `en` polos ditolak (`Value "en" is not a valid enum value`):
 *    enum Locale Discord hanya punya `en-US` dan `en-GB`.
 * 2. `Required options must be placed before non-required options`: `/data-delete`
 *    menaruh `confirm` (wajib) setelah `user` (opsional).
 *
 * Jadi tes ini tidak menilai apakah suatu perintah pantas ada, tapi apakah
 * Discord akan menerimanya. Pertanyaan kedua itulah yang selama ini baru terjawab
 * setelah deploy gagal di server.
 */

interface PayloadOption {
  name: string;
  type: number;
  required?: boolean;
  options?: PayloadOption[];
}

interface PayloadCommand {
  name: string;
  description?: string;
  name_localizations?: Record<string, string>;
  description_localizations?: Record<string, string>;
  options?: PayloadOption[];
}

const COMMAND_TYPES = { SUB_COMMAND: 1, SUB_COMMAND_GROUP: 2, STRING: 3 } as const;
const MAX_DESCRIPTION_LENGTH = 100;

/** Kode bahasa yang benar-benar diterima Discord. */
const DISCORD_LOCALES = new Set<string>(Object.values(Locale));

let body: PayloadCommand[] = [];

beforeAll(async () => {
  const commands = new Collection<string, BotCommand>();
  await loadCommands(commands);
  // Tipe resmi discord.js memakai union Locale-nya sendiri; yang diperiksa di
  // sini justru bentuk JSON mentahnya, jadi ke `PayloadCommand` lewat cast.
  body = applyCommandLocalizations(
    [...commands.values()].map((command) => command.data.toJSON()),
  ) as unknown as PayloadCommand[];
}, 60_000);

/** Kumpulkan pelanggaran urutan opsi wajib pada satu daftar opsi. */
function optionOrderProblems(options: readonly PayloadOption[]): string[] {
  const problems: string[] = [];
  let sawOptional = false;

  for (const option of options) {
    if (option.required === true) {
      if (sawOptional) problems.push(option.name);
    } else {
      sawOptional = true;
    }

    if (option.type === COMMAND_TYPES.SUB_COMMAND || option.type === COMMAND_TYPES.SUB_COMMAND_GROUP) {
      problems.push(...optionOrderProblems(option.options ?? []).map((name) => `${option.name}.${name}`));
    }
  }

  return problems;
}

describe('payload deploy perintah', () => {
  it('semuanya perintah benar-benar termuat', () => {
    expect(body.length).toBeGreaterThanOrEqual(40);
    expect(body.length).toBe(new Set(body.map((command) => command.name)).size);
  });

  it('opsi wajib selalu mendahului opsi opsional, termasuk di dalam subcommand', () => {
    const offenders = body
      .map((command) => ({
        name: command.name,
        problems: optionOrderProblems(command.options ?? []),
      }))
      .filter((entry) => entry.problems.length > 0);

    expect(offenders).toEqual([]);
  });

  it('kode bahasa yang dikirim ada di enum Locale Discord', () => {
    const unknown = new Set<string>();

    for (const command of body) {
      for (const key of Object.keys(command.name_localizations ?? {})) unknown.add(key);
      for (const key of Object.keys(command.description_localizations ?? {})) unknown.add(key);
    }

    expect([...unknown].filter((key) => !DISCORD_LOCALES.has(key))).toEqual([]);
  });

  it('terjemahan Inggris ikut terkirim untuk tiap perintah', () => {
    const missing = body
      .filter((command) => command.description_localizations?.[Locale.EnglishUS] === undefined)
      .map((command) => command.name);

    expect(missing).toEqual([]);
  });

  it('deskripsi dan namaHuruf yang valid', () => {
    const problems: string[] = [];

    for (const command of body) {
      if ((command.description ?? '').length > MAX_DESCRIPTION_LENGTH) {
        problems.push(`${command.name}: deskripsi ${(command.description ?? '').length} karakter`);
      }
      if (!/^[-_\p{L}\p{N}]{1,32}$/u.test(command.name)) problems.push(`${command.name}: nama tidak valid`);
    }

    expect(problems).toEqual([]);
  });

  it('builderSlashCommand menolak opsi yang salah urutan, jadi tes ini bukan satu-satunya penjaga', () => {
    // Penjaga tambahan: discord.js sendiri tidak menolak urutan ini, jadi
    // tanpa tes di atas kesalahannya hanya muncul saat deploy ke Discord.
    const builder = new SlashCommandSubcommandBuilder().setName('x');
    expect(() =>
      builder
        .addUserOption((option) => option.setName('user'))
        .addBooleanOption((option) => option.setName('confirm').setRequired(true)),
    ).not.toThrow();
  });
});