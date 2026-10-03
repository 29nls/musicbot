import { defaultTranslator, type Translator } from '../i18n/index.js';

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

/**
 * Hasil pemeriksaan hierarki.
 *
 * `messageKey` disimpan, bukan kalimatnya, supaya berkas ini tetap murni
 * tanpa perlu tahu bahasa apa pun. Pemanggil yang mengembalikannya
 * menjadi kalimat.
 */
export type HierarchyCheck =
  | { ok: true }
  | {
      ok: false;
      messageKey:
        | 'mod.hierarchy.self'
        | 'mod.hierarchy.botSelf'
        | 'mod.hierarchy.owner'
        | 'mod.hierarchy.botOutranked'
        | 'mod.hierarchy.actorOutranked';
    };

const fail = (
  messageKey: Extract<HierarchyCheck, { ok: false }>['messageKey'],
): HierarchyCheck => ({ ok: false, messageKey });

export function checkModerationHierarchy(input: HierarchyInput): HierarchyCheck {
  if (input.targetId === input.actorId) {
    return fail('mod.hierarchy.self');
  }

  if (input.targetId === input.botId) {
    return fail('mod.hierarchy.botSelf');
  }

  if (input.targetId === input.guildOwnerId) {
    return fail('mod.hierarchy.owner');
  }

  if (input.targetHighestRolePosition === null || input.requireOutrank === false) {
    return { ok: true };
  }

  if (input.botHighestRolePosition <= input.targetHighestRolePosition) {
    return fail('mod.hierarchy.botOutranked');
  }

  if (input.actorHighestRolePosition <= input.targetHighestRolePosition) {
    return fail('mod.hierarchy.actorOutranked');
  }

  return { ok: true };
}

/** Kalimat penolakan hierarki dalam bahasa yang diminta. */
export function hierarchyMessage(
  check: Extract<HierarchyCheck, { ok: false }>,
  t: Translator = defaultTranslator,
): string {
  return t(check.messageKey);
}
