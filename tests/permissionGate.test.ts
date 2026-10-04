import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { canManageGuild, hasGuildPermission } from '../src/utils/permissions.js';

/**
 * Gerbang izin server (PRD §9.4: "semua izin dicek server-side").
 *
 * Fungsinya satu baris, tapi baris itu adalah satu-satunya alasan `/setup`,
 * `/config`, `/logs`, dan `/logging` tidak bisa dipakai member biasa. Yang
 * diuji bukan cuma cabang yang terlihat, tapi **kenapa hanya ada satu
 * definisi**: hubungan itu dijaga supaya tidak ada yang menulis ulang aturan
 * ini di file lain tanpa memberi tahu.
 */

/** Interaksi palsu: yang diperiksa gate cuma `memberPermissions`. */
function interaction(permissions?: { has: (bit: bigint) => boolean }) {
  return { memberPermissions: permissions } as unknown as Parameters<
    typeof canManageGuild
  >[0];
}

const allow = { has: () => true };
const deny = { has: () => false };

describe('hasGuildPermission', () => {
  it('meloloskan anggota yang punya bitnya', () => {
    expect(hasGuildPermission(interaction(allow), PermissionFlagsBits.BanMembers)).toBe(true);
  });

  it('menolak anggota yang tidak punya bitnya', () => {
    expect(hasGuildPermission(interaction(deny), PermissionFlagsBits.BanMembers)).toBe(false);
  });

  it('menolak saat memberPermissions tidak ada', () => {
    // Interaksi di luar guild tidak punya izin apa pun. `?? false` di satu
    // tempat inilah yang mencegah DM melewati gerbang.
    expect(hasGuildPermission(interaction(), PermissionFlagsBits.BanMembers)).toBe(false);
  });

  it('meneruskan bit yang diminta, bukan hardcode Manage Server', () => {
    // Kalau bitnya diabaikan dan selalu dicek ManageGuild, semua perintah
    // dengan izin lain ikut lolos untuk moderator biasa.
    const seen: bigint[] = [];
    const recorder = {
      has: (bit: bigint) => {
        seen.push(bit);
        return true;
      },
    };

    hasGuildPermission(interaction(recorder), PermissionFlagsBits.ModerateMembers);

    expect(seen).toEqual([PermissionFlagsBits.ModerateMembers]);
  });
});

describe('canManageGuild', () => {
  it('hanya meloloskan Manage Server', () => {
    expect(canManageGuild(interaction(allow))).toBe(true);
    expect(canManageGuild(interaction(deny))).toBe(false);
    expect(canManageGuild(interaction())).toBe(false);
  });

  it('memakai helper yang sama, bukan pembacaan sendiri', () => {
    // Dua pembacaan independen bisa berbeda nanti — misalnya satu diisi
    // `?? true` oleh siapa pun yang terburu-buru. Menyatukan lewat helper
    // membuat itu mustahil terjadi tanpa terlihat di satu berkas.
    const source = readFileSync(
      fileURLToPath(new URL('../src/utils/permissions.ts', import.meta.url)),
      'utf8',
    );
    const body = source.slice(source.indexOf('export function canManageGuild'));

    expect(body).toContain('hasGuildPermission(');
    expect(body).not.toContain('memberPermissions');
  });
});

describe('penjaga satu definisi', () => {
  const SRC = fileURLToPath(new URL('../src', import.meta.url));
  const OWNER = join('utils', 'permissions.ts');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('tidak ada berkas lain yang membaca memberPermissions langsung', () => {
    // Tanpa penjaga ini, penambahan perintah baru akan cenderung menulis
    // `memberPermissions?.has(...)` lagi tanpa ada yang menegur.
    const offenders = walk(SRC)
      .filter((file) => !file.endsWith(OWNER))
      .filter((file) => /memberPermissions\??\.has\(/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it('penjaganya benar-benar bergigi: berkas contoh terdeteksi', () => {
    // Penjaga yang tidak pernah bisa gagal sama dengan tidak punya penjaga.
    // Yang diperiksa di sini adalah logikanya, dengan berkas nyata.
    const sample = 'const ok = interaction.memberPermissions?.has(bit) ?? false;';

    expect(/memberPermissions\??\.has\(/.test(sample)).toBe(true);
    expect(/memberPermissions\??\.has\(/.test('hasGuildPermission(interaction, bit)')).toBe(false);
  });
});
