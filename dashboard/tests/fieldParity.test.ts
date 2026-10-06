import { describe, expect, it } from 'vitest';
import configCommand from '@bot/commands/core/config.js';
import { DASHBOARD_VALUE_FIELDS, DASHBOARD_MODULES, DASHBOARD_EXCLUDED_MODULES } from '@/lib/fieldCatalog.js';
import { DASHBOARD_MODULE_KEYS, DASHBOARD_PATCH_KEYS } from '@/lib/fieldCatalog.js';

/**
 * SC-2 — paritas field dengan `/config set`.
 *
 * Tes ini membandingkan **dua daftar yang benar-benar dipakai runtime**: option
 * `SlashCommandBuilder` milik `/config set`, dan katalog field dashboard. Bukan
 * membandingkan ringkasan di PRD, karena dokumen bisa basi tanpa apa pun gagal —
 * yang harus gagal adalah kalau `/config` berubah dan dashboard tidak.
 *
 * Karena `/config` adalah default export dengan `.data`, tes bisa memuatnya tanpa
 * menjalankan bot: hanya bentuk payload Discord yang dibutuhkan.
 */

function configSetOptionNames(): { channels: string[]; roles: string[]; strings: string[]; integers: string[]; booleans: string[] } {
  const json = configCommand.data.toJSON() as {
    options?: {
      name: string;
      type: number;
      options?: { name: string; type: number }[];
    }[];
  };

  const set = json.options?.find((option) => option.name === 'set');
  const groups: Record<number, string[]> = { 7: [], 8: [], 3: [], 4: [], 5: [] };
  for (const option of set?.options ?? []) {
    groups[option.type]?.push(option.name);
  }

  return {
    channels: groups[7] ?? [],
    roles: groups[8] ?? [],
    strings: groups[3] ?? [],
    integers: groups[4] ?? [],
    booleans: groups[5] ?? [],
  };
}

const optionNames = configSetOptionNames();
const allOptionNames = [
  ...optionNames.channels,
  ...optionNames.roles,
  ...optionNames.strings,
  ...optionNames.integers,
  ...optionNames.booleans,
];

describe('SC-2 paritas field dengan /config set', () => {
  it('setiap field dashboard punya opsi dengan nama yang sama di /config set', () => {
    for (const field of DASHBOARD_VALUE_FIELDS) {
      expect(
        allOptionNames,
        `/config set tidak punya opsi "${field.commandOption}" untuk field ${field.patchKey}`,
      ).toContain(field.commandOption);
    }
  });

  it('setiap field nilai di /config set ada di dashboard — tidak ada yang kurang', () => {
    const valueOptions = [
      ...optionNames.channels,
      ...optionNames.roles,
      ...optionNames.strings,
      ...optionNames.integers,
    ];
    const dashboardOptions = DASHBOARD_VALUE_FIELDS.map((field) => field.commandOption);

    for (const option of valueOptions) {
      expect(dashboardOptions, `opsi /config "${option}" tidak ada di dashboard`).toContain(option);
    }
  });

  it('setiap opsi modul di /config set ada di dashboard — tidak ada yang kurang', () => {
    const dashboardModules = DASHBOARD_MODULES.map((module) => module.commandOption);

    for (const option of optionNames.booleans) {
      expect(dashboardModules, `opsi modul /config "${option}" tidak ada di dashboard`).toContain(option);
    }
  });

  it('dashboard tidak punya opsi yang tidak ada di /config set — tidak ada yang lebih', () => {
    expect([...DASHBOARD_VALUE_FIELDS.map((f) => f.commandOption), ...DASHBOARD_MODULES.map((m) => m.commandOption)].sort()).toEqual(
      [...allOptionNames].sort(),
    );
  });

  it('jumlah field tidak berubah diam-diam (12 nilai + 5 modul)', () => {
    expect(DASHBOARD_PATCH_KEYS).toHaveLength(12);
    expect(DASHBOARD_MODULE_KEYS).toHaveLength(5);
  });

  it('modul reactions dan tickets benar-benar absen dari dashboard', () => {
    // PRD-DASHBOARD §4.6: keduanya hanya bisa dinyalakan lewat `/setup` dan
    // dimatikan lewat perintah masing-masing, jadi `/config set` tidak punya
    // tombolnya dan dashboard tidak boleh menawarkan sesuatu yang tidak bisa
    // dilakukan lewat `/config`.
    expect(DASHBOARD_MODULE_KEYS).not.toContain('reactions');
    expect(DASHBOARD_MODULE_KEYS).not.toContain('tickets');
    expect([...DASHBOARD_EXCLUDED_MODULES].sort()).toEqual(['reactions', 'tickets']);
  });

  it('kolom tiket yang diatur perintah /ticket tidak ditawarkan dashboard', () => {
    // `ticketPanelMessageId` khususnya bukan keputusan manusia — itu hasil kirim
    // panel — jadi tidak boleh bisa ditulis dari mana pun yang dipakai manusia.
    expect(DASHBOARD_PATCH_KEYS).not.toContain('ticketPanelChannelId');
    expect(DASHBOARD_PATCH_KEYS).not.toContain('ticketCategoryId');
    expect(DASHBOARD_PATCH_KEYS).not.toContain('ticketStaffRoleId');
    expect(DASHBOARD_PATCH_KEYS).not.toContain('ticketPanelMessageId');
  });

  it('nama opsi dashboard unik', () => {
    const names = [...DASHBOARD_VALUE_FIELDS.map((f) => f.commandOption), ...DASHBOARD_MODULES.map((m) => m.commandOption)];
    expect(new Set(names).size).toBe(names.length);
  });

  it('nama field patch unik', () => {
    expect(new Set(DASHBOARD_PATCH_KEYS).size).toBe(DASHBOARD_PATCH_KEYS.length);
  });
});