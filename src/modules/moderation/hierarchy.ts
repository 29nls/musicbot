/**
 * Cek anti-hierarki (PRD §7.1). Murni — tidak menyentuh discord.js supaya
 * semua aturan bisa dites tanpa server Discord.
 *
 * Aturan:
 * 1. User tidak bisa memoderasi dirinya sendiri.
 * 2. Bot tidak bisa memoderasi dirinya sendiri.
 * 3. Pemilik server tidak bisa dimoderasi.
 * 4. Role bot & role moderator harus benar-benar di atas role target.
 */
export interface HierarchyInput {
  actorId: string;
  targetId: string;
  botId: string;
  guildOwnerId: string;
  actorHighestRolePosition: number;
  botHighestRolePosition: number;
  /** null kalau target bukan anggota server (mis. ban user yang sudah keluar). */
  targetHighestRolePosition: number | null;
  /** false = lewati aturan posisi role (dipakai kalau target tidak punya role sama sekali). */
  requireOutrank?: boolean;
}

export type HierarchyCheck = { ok: true } | { ok: false; message: string };

const fail = (message: string): HierarchyCheck => ({ ok: false, message });

export function checkModerationHierarchy(input: HierarchyInput): HierarchyCheck {
  if (input.targetId === input.actorId) {
    return fail('Kamu tidak bisa memoderasi dirimu sendiri.');
  }

  if (input.targetId === input.botId) {
    return fail('Aku tidak bisa memoderasi diriku sendiri. Pakai Discord langsung kalau memang perlu.');
  }

  if (input.targetId === input.guildOwnerId) {
    return fail('Pemilik server tidak bisa dimoderasi oleh bot.');
  }

  if (input.targetHighestRolePosition === null || input.requireOutrank === false) {
    return { ok: true };
  }

  if (input.botHighestRolePosition <= input.targetHighestRolePosition) {
    return fail('Role target lebih tinggi atau setara dengan role-ku, jadi aku tidak punya kuasa untuk memoderasinya.');
  }

  if (input.actorHighestRolePosition <= input.targetHighestRolePosition) {
    return fail('Role target lebih tinggi atau setara dengan role-mu. Minta moderator yang lebih senior.');
  }

  return { ok: true };
}
