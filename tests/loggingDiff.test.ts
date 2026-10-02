import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  diffIdSets,
  diffOverwrites,
  diffPermissions,
  diffValues,
  permissionNames,
  type OverwriteSnapshot,
} from '../src/modules/logging/diff.js';

describe('diffValues', () => {
  it('hanya menampilkan field yang berubah', () => {
    const lines = diffValues(
      { name: 'lama', topic: 'sama', nsfw: false },
      { name: 'baru', topic: 'sama', nsfw: true },
      [
        { key: 'name', label: 'Nama' },
        { key: 'topic', label: 'Topik' },
        { key: 'nsfw', label: 'NSFW' },
      ],
    );

    expect(lines).toEqual(['• **Nama**: lama → baru', '• **NSFW**: Tidak → Ya']);
  });

  it('memakai tanda — untuk null dan format kustom', () => {
    const lines = diffValues<{ value: string | null }>(
      { value: null },
      { value: 'x' },
      [{ key: 'value', label: 'Nilai' }],
    );

    expect(lines).toEqual(['• **Nilai**: — → x']);
  });

  it('tidak menghasilkan baris kalau nilainya sama', () => {
    expect(diffValues({ a: 1 }, { a: 1 }, [{ key: 'a', label: 'A' }])).toEqual([]);
  });
});

describe('diffIdSets', () => {
  it('memisahkan id yang ditambahkan dan dihapus', () => {
    expect(diffIdSets(['1', '2'], ['2', '3'])).toEqual({ added: ['3'], removed: ['1'] });
  });
});

describe('permissionNames & diffPermissions', () => {
  it('menerjemahkan bitfield menjadi nama izin', () => {
    const bits = PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers;
    const names = permissionNames(bits);

    expect(names).toHaveLength(2);
    expect(names).toEqual(expect.arrayContaining(['Ban Members', 'Kick Members']));
  });

  it('mendeteksi izin bertambah dan berkurang', () => {
    const result = diffPermissions(
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages,
    );

    expect(result.added).toContain('Send Messages');
    expect(result.removed).toEqual([]);

    const removed = diffPermissions(PermissionFlagsBits.ManageRoles, 0n);
    expect(removed.removed).toContain('Manage Roles');
  });
});

describe('diffOverwrites', () => {
  const snapshot: OverwriteSnapshot = {
    key: 'role:1',
    label: '<@&1>',
    allow: PermissionFlagsBits.ViewChannel,
    deny: 0n,
  };

  it('mendeteksi perubahan izinkan/tolak', () => {
    const lines = diffOverwrites(
      [snapshot],
      [{ ...snapshot, allow: 0n, deny: PermissionFlagsBits.ViewChannel }],
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('tolak +View Channel');
    expect(lines[0]).toContain('izinkan -View Channel');
  });

  it('mendeteksi overwrite ditambahkan dan dihapus', () => {
    expect(diffOverwrites([], [snapshot])).toEqual(['• <@&1>: overwrite **ditambahkan**']);
    expect(diffOverwrites([snapshot], [])).toEqual(['• <@&1>: overwrite **dihapus**']);
  });

  it('tidak menghasilkan apa-apa kalau overwrite sama', () => {
    expect(diffOverwrites([snapshot], [{ ...snapshot }])).toEqual([]);
  });
});
