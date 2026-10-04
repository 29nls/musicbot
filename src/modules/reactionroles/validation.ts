import { defaultTranslator, type MessageKey, type Translator } from '../i18n/index.js';
import {
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_PANEL_LIFETIME_MS,
  MAX_PANEL_OPTIONS,
  MIN_PANEL_LIFETIME_MS,
  PERMANENT_DURATION_TOKENS,
  type RoleInput,
} from './types.js';

/**
 * Error validasi yang pesannya aman ditampilkan ke user Discord.
 *
 * Yang disimpan adalah kunci katalog + parameternya, bukan kalimat jadi:
 * pemanggil yang menyusun embed menerjemahkannya ke bahasa server.
 * `message` tetap diisi bahasa Indonesia untuk log internal dan `toThrow`
 * di tes.
 */
export class ReactionRoleValidationError extends Error {
  public override readonly name = 'ReactionRoleValidationError';

  constructor(
    public readonly key: MessageKey,
    public readonly params?: Record<string, string | number>,
  ) {
    super(defaultTranslator(key, params));
  }
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export function assertSnowflake(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SNOWFLAKE_PATTERN.test(trimmed)) {
    throw new ReactionRoleValidationError('rr.err.invalidId', { label, value });
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
    throw new ReactionRoleValidationError('rr.err.tooManyOptions', {
      max: MAX_PANEL_OPTIONS,
      total,
    });
  }

  return result;
}

/** Setelah dihapus, panel harus masih punya minimal satu opsi. */
export function assertPanelKeepsOneOption(remaining: number): void {
  if (remaining < 1) {
    throw new ReactionRoleValidationError('rr.err.lastOption');
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
    throw new ReactionRoleValidationError('rr.err.noRoles');
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
    throw new ReactionRoleValidationError('rr.err.unreadableRoles');
  }

  return ids;
}

function trimToNull(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

const DURATION_UNIT_MS: Record<string, number> = {
  d: 86_400_000,
  hari: 86_400_000,
  h: 3_600_000,
  jam: 3_600_000,
  m: 60_000,
  menit: 60_000,
};

/**
 * Baca masa hidup panel dari input `/reactionrole post duration:`.
 *
 * null berarti **permanen** — entah karena opsi-nya dikosongkan (default) atau
 * admin menulis `permanen`. Input kosong bukan kesalahan, sedangkan input yang
 * tidak terbaca harus ditolak supaya admin tidak tanpa sadar membuat panel
 * yang tidak pernah berakhir.
 *
 * Mengembalikan waktu kedaluwarsa (bukan durasinya) supaya pemanggil tidak
 * perlu menghitung ulang; `now` bisa disuntikkan agar aturannya bisa diuji.
 */
export function parsePanelDuration(
  input: string | null | undefined,
  now = new Date(),
): Date | null {
  const trimmed = input?.trim().toLowerCase();
  if (!trimmed) return null;
  if (PERMANENT_DURATION_TOKENS.includes(trimmed)) return null;

  const match = /^(\d{1,5})\s*([a-z]*)$/.exec(trimmed);
  const amountText = match?.[1];
  if (!amountText) {
    throw new ReactionRoleValidationError('rr.err.durationUnreadable', {
      value: input?.trim() ?? '',
    });
  }

  const amount = Number(amountText);
  const unit = match?.[2] ?? '';
  // Tanpa satuan dianggap jam — panel biasanya dipakai per acara, bukan per menit.
  const multiplier = unit === '' ? 3_600_000 : DURATION_UNIT_MS[unit];
  if (multiplier === undefined) {
    throw new ReactionRoleValidationError('rr.err.durationUnit', { unit });
  }

  const ms = amount * multiplier;
  if (ms < MIN_PANEL_LIFETIME_MS) {
    throw new ReactionRoleValidationError('rr.err.durationMin');
  }
  if (ms > MAX_PANEL_LIFETIME_MS) {
    throw new ReactionRoleValidationError('rr.err.durationMax');
  }

  return new Date(now.getTime() + ms);
}

/** 604_800_000 → "7 hari" (untuk embed & balasan perintah). */
export function describePanelLifetime(
  ms: number,
  t: Translator = defaultTranslator,
): string {
  if (!Number.isFinite(ms) || ms <= 0) return t('rr.lifetime.minutes', { count: 0 });
  if (ms % 86_400_000 === 0) return t('rr.lifetime.days', { count: ms / 86_400_000 });
  if (ms % 3_600_000 === 0) return t('rr.lifetime.hours', { count: ms / 3_600_000 });
  if (ms % 60_000 === 0) return t('rr.lifetime.minutes', { count: ms / 60_000 });

  return t('rr.lifetime.minutes', { count: Math.round(ms / 60_000) });
}
