import { publishConfigChanged } from '@bot/modules/config/invalidation.js';
import { ConfigValidationError, validatePatch } from '@bot/modules/config/validation.js';
import type { GuildConfig, GuildConfigPatch } from '@bot/modules/config/types.js';
import type { KeyValueStore } from '@bot/services/kvStore.js';
import type { AuditChange } from './audit.js';
import {
  DASHBOARD_MODULE_KEYS,
  DASHBOARD_PATCH_KEYS,
  findValueField,
} from './fieldCatalog.js';
import type { PermissionVerdict } from './permissions.js';
import { checkWriteRateLimit } from './rateLimit.js';

/**
 * Jalur satu-satunya untuk menulis konfigurasi dari dashboard.
 *
 * Modul ini murni: tidak ada Next.js, tidak ada `fetch` ke Discord, tidak ada
 * klien Prisma. Semuanya masuk lewat `ConfigWriteDeps`, jadi setiap aturan di
 * bawah bisa diuji tanpa jaringan, tanpa database, dan tanpa token Discord.
 *
 * **Urutannya sendiri bagian dari kontrak ini.** Tiap langkah menolak sebelum
 * melakukan langkah yang lebih mahal atau lebih berbahaya:
 *
 * 1. Field di luar katalog ditolak lebih dulu. Bukan soal aesthetics:
 *    `guild_config` punya kolom seperti `ticketPanelMessageId` yang sengaja
 *    tidak bisa diubah manusia, dan kalau body mentah diteruskan ke Prisma,
 *    kolom itu bisa ditulis lewat dashboard.
 * 2. Izin Manage Server dicek ulang lewat token bot. Bukan saat login — izin
 *    bisa dicabut kapan saja (skenario §2.4 baris 1).
 * 3. Rate limit, sebelum query Discord dan database, supaya percobaan otomatis
 *    100 per detik tidak menghasilkan 100 panggilan Discord.
 * 4. Validasi bentuk memakai `validatePatch` milik bot. Satu aturan validasi
 *    untuk dua jalur; tidak ada versi dashboard yang lebih longgar.
 * 5. ID channel dan role harus benar-benar milik guild ini, dibandingkan dengan
 *    daftar yang diterima dari Discord, bukan dipercaya begitu saja (§2.4 baris 3).
 * 6. Kanal invalidasi harus bisa menerbitkan **sebelum** ada yang ditulis. Kalau
 *    tidak, tulisannya ditolak (D3). Dicek sebelum commit supaya tidak ada baris
 *    yang sudah tersimpan lalu ditolak karena bot tidak diberi tahu.
 * 7. `guild_config` dan `log_entry` ditulis dalam satu transaksi, supaya tidak
 *    ada keadaan setengah tertulis.
 * 8. Invalidasi diterbitkan sesudah transaksi selesai.
 */

export type WriteFailureReason =
  | 'forbidden'
  | 'permission-unknown'
  | 'rate-limited'
  | 'shared-store-down'
  | 'invalid-field'
  | 'invalid-value'
  | 'foreign-id'
  | 'database-down';

export interface WriteIssue {
  field: string;
  message: string;
}

export type WriteResult =
  | {
      ok: true;
      config: GuildConfig;
      changes: AuditChange[];
      /** Invalidasi berhasil diterbitkan ke proses bot. */
      invalidated: boolean;
      /** Audit tersimpan? `false` berarti perubahan berlaku tapi jejaknya hilang. */
      auditRecorded: boolean;
    }
  | {
      ok: false;
      reason: WriteFailureReason;
      issues: WriteIssue[];
      /** Hanya untuk `rate-limited`: detik yang harus ditunggu. */
      retryAfterSeconds?: number;
    };

export interface GuildSnapshot {
  /** ID channel milik guild ini. */
  channelIds: readonly string[];
  /** ID role milik guild ini. */
  roleIds: readonly string[];
}

export interface SaveAudit {
  executorId: string;
  changes: readonly AuditChange[];
  logChannelId: string | null;
}

export interface ConfigWriteDeps {
  /** Konfigurasi sekarang, untuk merge dan nilai lama. */
  readConfig(guildId: string): Promise<GuildConfig>;
  /**
   * Tulis konfigurasi + audit dalam satu transaksi.
   *
   * `auditRecorded` boleh `false` hanya kalau audit gagal sementara konfigurasi
   * tetap commit: membatalkan penulisan demi audit akan lebih buruk daripada
   * kehilangan satu baris riwayat, dan pemanggil menampilkan peringatan.
   */
  save(config: GuildConfig, audit: SaveAudit): Promise<{ saved: GuildConfig; auditRecorded: boolean }>;
  checkPermission(guildId: string, userId: string): Promise<PermissionVerdict>;
  /** Channel & role milik guild; `null` berarti Discord tidak menjawab. */
  readGuildSnapshot(guildId: string): Promise<GuildSnapshot | null>;
  store: KeyValueStore;
  now?: () => Date;
}

const CHANNEL_KEYS = DASHBOARD_PATCH_KEYS.filter((key) => findValueField(key)?.kind === 'channel');
const ROLE_KEYS = DASHBOARD_PATCH_KEYS.filter((key) => findValueField(key)?.kind === 'role');

/** Kunci yang harus ditolak apa pun bentuknya: hanya berlaku untuk polusi prototipe. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sisakan hanya kunci yang boleh diubah.
 *
 * `Object.entries` pada array menghasilkan kunci `"0"`, `"1"`, dan seterusnya;
 * itu bukan nama field, jadi harus ditolak sebelum cek allowed — bukan setelah.
 */
function collectAllowed(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prefix = '',
): { accepted: Record<string, unknown>; rejected: string[] } {
  const accepted: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    const path = prefix ? `${prefix}${key}` : key;

    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      rejected.push(path);
      continue;
    }
    accepted[key] = value;
  }

  return { accepted, rejected };
}

/**
 * Bentuk body → patch yang aman ditulis.
 *
 * Bentuk yang bukan objek biasa menghasilkan `rejected` berisi penanda, bukan
 * objek patch kosong, supaya pemanggil bisa menjawab "body tidak dikenal"
 * alih-alih "tidak ada field yang dikirim" — dua masalah yang beda.
 */
export function sanitizeBody(
  body: unknown,
): { ok: true; patch: Record<string, unknown> } | { ok: false; rejected: string[] } {
  if (!isPlainRecord(body)) return { ok: false, rejected: ['(body)'] };

  const top = collectAllowed(
    body,
    new Set<string>([...DASHBOARD_PATCH_KEYS, 'modules']),
  );
  if (top.rejected.length > 0) return { ok: false, rejected: top.rejected };

  const accepted = top.accepted;

  if (accepted.modules !== undefined) {
    if (!isPlainRecord(accepted.modules)) return { ok: false, rejected: ['modules'] };

    const modules = collectAllowed(
      accepted.modules,
      new Set<string>(DASHBOARD_MODULE_KEYS),
      'modules.',
    );
    if (modules.rejected.length > 0) return { ok: false, rejected: modules.rejected };

    accepted.modules = modules.accepted;
  }

  return { ok: true, patch: accepted };
}

/** Bentuk yang enak dibaca manusia untuk audit; nilai panjang dipotong. */
function humanValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return 'kosong';

  if (field === 'welcomeMessage' || field === 'goodbyeMessage') {
    const text = String(value);
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  }

  return String(value);
}

/** Field yang benar-benar berubah antara dua konfigurasi. */
export function diffConfig(before: GuildConfig, after: GuildConfig): AuditChange[] {
  const changes: AuditChange[] = [];

  for (const key of DASHBOARD_PATCH_KEYS) {
    const oldValue = before[key];
    const newValue = after[key];

    if (oldValue !== newValue) {
      changes.push({ field: key, before: humanValue(key, oldValue), after: humanValue(key, newValue) });
    }
  }

  for (const moduleKey of DASHBOARD_MODULE_KEYS) {
    const oldValue = before.modules[moduleKey];
    const newValue = after.modules[moduleKey];

    if (oldValue !== newValue) {
      changes.push({
        field: `modules.${moduleKey}`,
        before: oldValue ? 'aktif' : 'mati',
        after: newValue ? 'aktif' : 'mati',
      });
    }
  }

  return changes;
}

/** ID channel dan role yang disebut patch, dipisah menurut jenisnya. */
function referencedIds(patch: GuildConfigPatch): { channelIds: string[]; roleIds: string[] } {
  const channelIds: string[] = [];
  const roleIds: string[] = [];

  for (const key of CHANNEL_KEYS) {
    const value = patch[key];
    if (typeof value === 'string') channelIds.push(value);
  }
  for (const key of ROLE_KEYS) {
    const value = patch[key];
    if (typeof value === 'string') roleIds.push(value);
  }

  return { channelIds, roleIds };
}

export async function applyConfigPatch(
  deps: ConfigWriteDeps,
  params: { guildId: string; userId: string; body: unknown },
): Promise<WriteResult> {
  const { guildId, userId, body } = params;

  const sanitized = sanitizeBody(body);
  if (!sanitized.ok) {
    return {
      ok: false,
      reason: 'invalid-field',
      issues: sanitized.rejected.map((field) => ({
        field,
        message: 'field ini tidak bisa diubah dari dashboard',
      })),
    };
  }

  if (Object.keys(sanitized.patch).length === 0) {
    return {
      ok: false,
      reason: 'invalid-value',
      issues: [{ field: '(root)', message: 'tidak ada field yang dikirim' }],
    };
  }

  const verdict = await deps.checkPermission(guildId, userId);
  if (verdict === 'denied') return { ok: false, reason: 'forbidden', issues: [] };
  if (verdict === 'unknown') return { ok: false, reason: 'permission-unknown', issues: [] };

  let rate;
  try {
    rate = await checkWriteRateLimit(deps.store, guildId, userId);
  } catch {
    return { ok: false, reason: 'shared-store-down', issues: [] };
  }
  if (!rate.allowed) {
    return {
      ok: false,
      reason: 'rate-limited',
      issues: [],
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  let validated: GuildConfigPatch;
  try {
    validated = validatePatch(sanitized.patch as GuildConfigPatch);
  } catch (error) {
    const details =
      error instanceof ConfigValidationError ? error.params?.details : undefined;
    const message = typeof details === 'string' ? details : (error instanceof Error ? error.message : 'nilai tidak valid');

    return { ok: false, reason: 'invalid-value', issues: [{ field: 'patch', message }] };
  }

  const { channelIds, roleIds } = referencedIds(validated);
  const needsSnapshot = channelIds.length > 0 || roleIds.length > 0;

  if (needsSnapshot) {
    const snapshot = await deps.readGuildSnapshot(guildId);
    if (!snapshot) return { ok: false, reason: 'permission-unknown', issues: [] };

    const known = new Set<string>([...snapshot.channelIds, ...snapshot.roleIds]);
    const foreign = [...channelIds, ...roleIds].filter((id) => !known.has(id));

    if (foreign.length > 0) {
      return {
        ok: false,
        reason: 'foreign-id',
        issues: foreign.map((id) => ({ field: 'id', message: `${id} bukan bagian dari server ini` })),
      };
    }
  }

  const current = await deps.readConfig(guildId);
  const next: GuildConfig = {
    ...current,
    ...validated,
    modules: { ...current.modules, ...(validated.modules ?? {}) },
    guildId,
  };

  const changes = diffConfig(current, next);
  const now = deps.now?.() ?? new Date();

  if (changes.length === 0) {
    return { ok: true, config: current, changes: [], invalidated: true, auditRecorded: true };
  }

  const published = await publishConfigChanged(deps.store, {
    guildId,
    fields: changes.map((change) => change.field),
    source: 'dashboard',
    at: now.toISOString(),
  });
  if (!published) return { ok: false, reason: 'shared-store-down', issues: [] };

  let saved: GuildConfig;
  let auditRecorded: boolean;
  try {
    const result = await deps.save(next, {
      executorId: userId,
      changes,
      logChannelId: next.logChannelId,
    });
    saved = result.saved;
    auditRecorded = result.auditRecorded;
  } catch {
    return { ok: false, reason: 'database-down', issues: [] };
  }

  return { ok: true, config: saved, changes, invalidated: true, auditRecorded };
}