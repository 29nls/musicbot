import { isStatKind } from './validation.js';
import type { StatEntry } from './types.js';

/**
 * Bentuk baris tabel `playback_stat` yang dibutuhkan pemetaan.
 * Didefinisikan lokal (bukan tipe Prisma) supaya bisa dites tanpa database.
 */
export interface PlaybackStatRow {
  guildId: string;
  kind: string;
  key: string;
  label: string;
  day: Date;
  count: number;
  listenedMs: bigint | number;
  updatedAt?: Date;
}

/**
 * Baris database → domain.
 *
 * Dua hal dijaga di sini, karena keduanya datang dari luar (baris lama ditulis
 * versi kode sebelumnya, atau ada yang mengubahnya manual):
 *
 * - **`kind` tak dikenal dilewati, bukan dipaksa jadi `track`.** Leaderboard
 *   yang diam-diam mencampur jenis yang tidak bisa dijelaskan lebih buruk
 *   daripada baris itu tidak pernah ditampilkan.
 * - **`listenedMs` dibaca dari `bigint` atau `number`.** Prisma mengembalikan
 *   `bigint`, tapi konversi manual (dump SQL, skrip admin) mengembalikan
 *   `number`; `BigInt(NaN)` melempar dan satu baris rusak tidak boleh
 *   menggagalkan seluruh `/stats`.
 */
export function toDomain(row: PlaybackStatRow): StatEntry | null {
  if (!isStatKind(row.kind)) return null;

  const day = new Date(row.day);
  if (Number.isNaN(day.getTime())) return null;

  const count = Number.isFinite(row.count) ? Math.max(0, Math.trunc(row.count)) : 0;
  const listened = toSafeNumber(row.listenedMs);

  return {
    guildId: row.guildId,
    kind: row.kind,
    key: row.key,
    label: row.label,
    day,
    count,
    listenedMs: listened,
  };
}

/** Versi yang membuang baris tak terbaca, untuk dipakai saat membaca daftar. */
export function toDomainList(rows: readonly PlaybackStatRow[]): StatEntry[] {
  return rows
    .map((row) => toDomain(row))
    .filter((entry): entry is StatEntry => entry !== null);
}

/** Pemetaan terbalik untuk penulisan (repository Prisma). */
export function toRow(entry: StatEntry): PlaybackStatRow {
  return {
    guildId: entry.guildId,
    kind: entry.kind,
    key: entry.key,
    label: entry.label,
    day: entry.day,
    count: entry.count,
    listenedMs: entry.listenedMs,
  };
}

/** Buang hari ke 00:00 UTC supaya cocok dengan kolom `DATE`. */
export function toDayColumn(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0),
  );
}

function toSafeNumber(value: bigint | number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  }

  try {
    const result = Number(value);
    return Number.isFinite(result) ? Math.max(0, result) : 0;
  } catch {
    return 0;
  }
}