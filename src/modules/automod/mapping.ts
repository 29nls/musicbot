import {
  DEFAULT_THRESHOLDS,
  isAutomodAction,
  isAutomodRuleType,
  type AutomodAction,
  type AutomodRule,
  type AutomodWhitelist,
} from './types.js';

/** Bentuk baris tabel `automod_rule` yang dibutuhkan pemetaan (lokal, bukan tipe Prisma). */
export interface AutomodRuleRow {
  guildId: string;
  type: string;
  enabled: boolean;
  threshold: number;
  actions: unknown;
  whitelist: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Kolom JSON bisa berisi data lama/rusak — nilai aneh jatuh ke daftar kosong. */
export function parseWhitelist(value: unknown): AutomodWhitelist {
  const record = isRecord(value) ? value : {};

  return {
    channels: readStringArray(record.channels),
    roles: readStringArray(record.roles),
    domains: readStringArray(record.domains),
    words: readStringArray(record.words),
    invites: readStringArray(record.invites),
  };
}

/** Minimal satu aksi; data rusak jatuh ke "hapus pesan" supaya rule tetap aman. */
export function parseActions(value: unknown): AutomodAction[] {
  const actions = readStringArray(value).filter(isAutomodAction);
  return actions.length > 0 ? actions : ['delete'];
}

/** Baris DB → domain. null kalau tipe rule tidak dikenal (baris sisa versi lama). */
export function toDomain(row: AutomodRuleRow): AutomodRule | null {
  if (!isAutomodRuleType(row.type)) return null;

  return {
    type: row.type,
    enabled: row.enabled,
    threshold: Number.isFinite(row.threshold) ? row.threshold : DEFAULT_THRESHOLDS[row.type],
    actions: parseActions(row.actions),
    whitelist: parseWhitelist(row.whitelist),
  };
}
