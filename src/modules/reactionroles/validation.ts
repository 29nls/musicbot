import {
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_PANEL_OPTIONS,
  type RoleInput,
} from './types.js';

/** Error validasi yang pesannya aman ditampilkan ke user Discord. */
export class ReactionRoleValidationError extends Error {
  public override readonly name = 'ReactionRoleValidationError';

  constructor(message: string) {
    super(message);
  }
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export function assertSnowflake(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SNOWFLAKE_PATTERN.test(trimmed)) {
    throw new ReactionRoleValidationError(`ID ${label} tidak valid: \`${value}\`.`);
  }
  return trimmed;
}

/**
 * Buang role yang sudah ada di panel, potong label/deskripsi ke batas Discord,
 * lalu pastikan jumlah akhirnya masih muat di satu select menu.
 *
 * Murni: `existing` boleh berisi role yang sudah ada supaya `add` tidak
 * diam-diam membuat baris kembar.
 */
export function normalizeRoleInputs(
  roles: readonly RoleInput[],
  existing: readonly string[] = [],
): RoleInput[] {
  const seen = new Set(existing);
  const result: RoleInput[] = [];

  for (const role of roles) {
    const roleId = assertSnowflake(role.roleId, 'role');
    if (seen.has(roleId)) continue;
    seen.add(roleId);

    result.push({
      roleId,
      label: trimToNull(role.label, MAX_OPTION_LABEL_LENGTH),
      emoji: trimToNull(role.emoji, 20),
      description: trimToNull(role.description, MAX_OPTION_DESCRIPTION_LENGTH),
    });
  }

  const total = existing.length + result.length;
  if (total > MAX_PANEL_OPTIONS) {
    throw new ReactionRoleValidationError(
      `Satu panel maksimal ${MAX_PANEL_OPTIONS} role (sekarang ${total}). ` +
        'Buat panel terpisah, atau kurangi role yang ditambahkan.',
    );
  }

  return result;
}

/** Setelah dihapus, panel harus masih punya minimal satu opsi. */
export function assertPanelKeepsOneOption(remaining: number): void {
  if (remaining < 1) {
    throw new ReactionRoleValidationError(
      'Ini opsi terakhir di panel. Hapus panelnya dengan `/reactionrole delete` kalau memang tidak dipakai lagi.',
    );
  }
}

const ROLE_MENTION_PATTERN = /<@&(\d{17,20})>/g;
const BARE_ID_PATTERN = /\b\d{17,20}\b/g;

/**
 * Baca daftar role dari satu opsi string.
 *
 * Menerima `<@&123…>` (mention yang Discord sisipkan saat memilih role dari
 * autocomplete), angka polos, dan keduanya dipisah spasi/koma. Menolak `@nama`
 * biasa karena Discord tidak menyelesaikannya jadi ID di dalam string.
 *
 * Murni supaya Aturan ini bisa diuji tanpa Discord.
 */
export function parseRoleMentions(input: string | null | undefined): string[] {
  const raw = input?.trim();
  if (!raw) {
    throw new ReactionRoleValidationError(
      'Sebutkan minimal satu role, contoh: `@Pemain @Penggemar`.',
    );
  }

  const ids: string[] = [];
  const matches = raw.matchAll(ROLE_MENTION_PATTERN);
  for (const match of matches) {
    const id = match[1];
    if (id && !ids.includes(id)) ids.push(id);
  }

  // Angka polos hanya dibaca kalau tidak ada mention sama sekali — supaya
  // `<@&123>` tidak terhitung dua kali lewat dua pola.
  if (ids.length === 0) {
    for (const match of raw.matchAll(BARE_ID_PATTERN)) {
      const id = match[0];
      if (!ids.includes(id)) ids.push(id);
    }
  }

  if (ids.length === 0) {
    throw new ReactionRoleValidationError(
      'Role tidak terbaca. Pilih role lewat autocomplete `@` agar tersimpan sebagai mention ' +
        '(`<@&123…>`), atau tulis ID role-nya.',
    );
  }

  return ids;
}

function trimToNull(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
